/*
 * Process Mining — Splunk Custom Visualization
 *
 * Renders a process mining directed graph from raw event sequences.
 * Computes transitions, builds a Sugiyama-inspired layered layout,
 * and draws interactive nodes and edges on Canvas 2D.
 *
 * Expected SPL columns: _time, case_id, activity, status (optional), resource (optional), shape (optional)
 */
define([
    'api/SplunkVisualizationBase',
    'api/SplunkVisualizationUtils'
], function(SplunkVisualizationBase, SplunkVisualizationUtils) {

    // ── Pure helper functions ────────────────────────────────────

    /**
     * Truncate text to maxLen characters, appending ellipsis if needed.
     * Defaults to 20 characters.
     */
    function truncateText(text, maxLen) {
        var limit = (maxLen !== undefined && maxLen !== null) ? maxLen : 20;
        if (!text) return '';
        var s = String(text);
        if (s.length <= limit) return s;
        return s.slice(0, limit - 1) + '\u2026';
    }

    /**
     * Compute the median of a numeric array.
     * Returns 0 for empty arrays.
     */
    function median(arr) {
        if (!arr || arr.length === 0) return 0;
        var sorted = arr.slice().sort(function(a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        }
        return sorted[mid];
    }

    /**
     * Format a duration in milliseconds as a human-readable string.
     * Examples: "3d 2h 15m", "45m", "< 1m"
     */
    function formatDuration(ms) {
        if (ms === null || ms === undefined || isNaN(ms)) return '< 1m';
        var totalMinutes = Math.floor(ms / 60000);
        if (totalMinutes < 1) return '< 1m';
        var minutes = totalMinutes % 60;
        var totalHours = Math.floor(totalMinutes / 60);
        var hours = totalHours % 24;
        var days = Math.floor(totalHours / 24);
        var parts = [];
        if (days > 0) parts.push(days + 'd');
        if (hours > 0) parts.push(hours + 'h');
        if (minutes > 0) parts.push(minutes + 'm');
        if (parts.length === 0) return '< 1m';
        return parts.join(' ');
    }

    /**
     * Format a large count for display: 1000 -> "1k", 1500000 -> "1.5M", etc.
     */
    function formatCount(n) {
        if (n === null || n === undefined) return '0';
        if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(n);
    }

    /**
     * Build a process graph from raw row data.
     *
     * @param {Array}  rows          - Array of row arrays from Splunk
     * @param {Object} colIdx        - Column name -> index map
     * @param {string} caseField     - Column name for case_id
     * @param {string} activityField - Column name for activity
     * @param {string} timeField     - Column name for _time (epoch seconds)
     * @param {string} statusField   - Column name for status (optional, may be null)
     * @param {string} resourceField - Column name for resource (optional, may be null)
     *
     * @returns {Object} { nodes, edges, cases, variantCount }
     */
    function buildProcessGraph(rows, colIdx, caseField, activityField, timeField, statusField, resourceField, shapeField) {
        var casesMap = {};      // caseId -> array of { time, activity, status, resource, origIdx }
        var caseOrder = [];     // preserve insertion order of case IDs

        var timeIdx     = (timeField     && colIdx[timeField]     !== undefined) ? colIdx[timeField]     : -1;
        var caseIdx     = (caseField     && colIdx[caseField]     !== undefined) ? colIdx[caseField]     : -1;
        var activityIdx = (activityField && colIdx[activityField] !== undefined) ? colIdx[activityField] : -1;
        var statusIdx   = (statusField   && colIdx[statusField]   !== undefined) ? colIdx[statusField]   : -1;
        var resourceIdx = (resourceField && colIdx[resourceField] !== undefined) ? colIdx[resourceField] : -1;
        var shapeIdx    = (shapeField   && colIdx[shapeField]   !== undefined) ? colIdx[shapeField]   : -1;

        // Pass 1: group events by case, drop rows with unparseable _time
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];

            // Parse time
            var rawTime = (timeIdx >= 0) ? row[timeIdx] : null;
            var parsedTime = parseFloat(rawTime);
            if (isNaN(parsedTime)) continue; // silently drop

            var caseId   = (caseIdx >= 0 && row[caseIdx] !== null && row[caseIdx] !== undefined) ? String(row[caseIdx]) : '__unknown__';
            var activity = (activityIdx >= 0 && row[activityIdx] !== null && row[activityIdx] !== undefined) ? String(row[activityIdx]) : '(unknown)';
            var status   = (statusIdx >= 0 && row[statusIdx] !== null && row[statusIdx] !== undefined) ? String(row[statusIdx]) : null;
            var resource = (resourceIdx >= 0 && row[resourceIdx] !== null && row[resourceIdx] !== undefined) ? String(row[resourceIdx]) : null;
            var shape    = (shapeIdx >= 0 && row[shapeIdx] !== null && row[shapeIdx] !== undefined) ? String(row[shapeIdx]) : null;

            if (!casesMap[caseId]) {
                casesMap[caseId] = [];
                caseOrder.push(caseId);
            }
            casesMap[caseId].push({ time: parsedTime, activity: activity, status: status, resource: resource, shape: shape, origIdx: i });
        }

        var nodesMap = {};   // nodeId -> { id, name, count, statuses: {}, resources: {} }
        var edgesMap = {};   // "from->to" -> { from, to, count, durations: [] }
        var casesOut = [];
        var variantMap = {};

        // Helpers for nodes and edges
        function ensureNode(id, name) {
            if (!nodesMap[id]) {
                nodesMap[id] = { id: id, name: name, count: 0, statuses: {}, resources: {}, shapes: {} };
            }
        }

        function touchNode(id, name, status, resource, shape) {
            ensureNode(id, name);
            nodesMap[id].count++;
            if (status) {
                nodesMap[id].statuses[status] = (nodesMap[id].statuses[status] || 0) + 1;
            }
            if (resource) {
                nodesMap[id].resources[resource] = (nodesMap[id].resources[resource] || 0) + 1;
            }
            if (shape) {
                nodesMap[id].shapes[shape] = (nodesMap[id].shapes[shape] || 0) + 1;
            }
        }

        function touchEdge(fromId, toId, durationMs) {
            var key = fromId + '->' + toId;
            if (!edgesMap[key]) {
                edgesMap[key] = { from: fromId, to: toId, count: 0, durations: [] };
            }
            edgesMap[key].count++;
            if (durationMs !== null && !isNaN(durationMs)) {
                edgesMap[key].durations.push(durationMs);
            }
        }

        // Ensure Start and End nodes exist
        ensureNode('__start__', 'Start');
        ensureNode('__end__', 'End');

        // Pass 2: process each case
        for (var ci = 0; ci < caseOrder.length; ci++) {
            var caseId = caseOrder[ci];
            var events = casesMap[caseId];

            // Sort by time, tiebreak by original row index
            events.sort(function(a, b) {
                if (a.time !== b.time) return a.time - b.time;
                return a.origIdx - b.origIdx;
            });

            var activitySeq = [];
            var hasSelfLoop = false;
            var startTime = events[0].time * 1000; // convert epoch seconds -> ms
            var endTime   = events[events.length - 1].time * 1000;

            // Build transitions
            // Prepend Start -> first activity
            var firstId = events[0].activity;
            touchNode(firstId, events[0].activity, events[0].status, events[0].resource, events[0].shape);
            var startDur = null; // No duration for Start -> first
            touchEdge('__start__', firstId, startDur);
            nodesMap['__start__'].count++;

            activitySeq.push(firstId);

            // Consecutive pairs
            for (var ei = 1; ei < events.length; ei++) {
                var prevEvent = events[ei - 1];
                var currEvent = events[ei];
                var prevId = prevEvent.activity;
                var currId = currEvent.activity;

                touchNode(currId, currEvent.activity, currEvent.status, currEvent.resource, currEvent.shape);

                var durationMs = (currEvent.time - prevEvent.time) * 1000;
                touchEdge(prevId, currId, durationMs);

                if (prevId === currId) {
                    hasSelfLoop = true;
                }

                activitySeq.push(currId);
            }

            // Append last activity -> End
            var lastId = events[events.length - 1].activity;
            var endDur = null; // No duration for last -> End
            touchEdge(lastId, '__end__', endDur);
            nodesMap['__end__'].count++;

            // Track variants by stringifying activity sequence
            var variantKey = activitySeq.join('|');
            variantMap[variantKey] = (variantMap[variantKey] || 0) + 1;

            casesOut.push({
                id: caseId,
                activities: activitySeq,
                startTime: startTime,
                endTime: endTime,
                hasSelfLoop: hasSelfLoop
            });
        }

        // Convert maps to arrays
        var nodesArr = [];
        for (var nk in nodesMap) {
            if (nodesMap.hasOwnProperty(nk)) {
                nodesArr.push(nodesMap[nk]);
            }
        }

        var edgesArr = [];
        for (var ek in edgesMap) {
            if (edgesMap.hasOwnProperty(ek)) {
                edgesArr.push(edgesMap[ek]);
            }
        }

        var variantCount = 0;
        for (var vk in variantMap) {
            if (variantMap.hasOwnProperty(vk)) {
                variantCount++;
            }
        }

        return {
            nodes: nodesArr,
            edges: edgesArr,
            cases: casesOut,
            variantCount: variantCount
        };
    }

    /**
     * Compute summary KPIs from graph data.
     *
     * @param {Object} graphData - Output of buildProcessGraph
     * @returns {Object} { caseCount, activityCount, medianDuration, avgDuration, selfLoopPct, variantCount }
     */
    function computeKPIs(graphData) {
        var caseCount = graphData.cases.length;

        // Subtract 2 for __start__ and __end__ nodes
        var activityCount = Math.max(0, graphData.nodes.length - 2);

        // Duration arrays
        var durations = [];
        for (var i = 0; i < graphData.cases.length; i++) {
            var c = graphData.cases[i];
            var dur = c.endTime - c.startTime;
            durations.push(dur);
        }

        var medianDuration = median(durations);

        var avgDuration = 0;
        if (durations.length > 0) {
            var sum = 0;
            for (var j = 0; j < durations.length; j++) {
                sum += durations[j];
            }
            avgDuration = sum / durations.length;
        }

        var selfLoopCount = 0;
        for (var k = 0; k < graphData.cases.length; k++) {
            if (graphData.cases[k].hasSelfLoop) selfLoopCount++;
        }
        var selfLoopPct = (caseCount > 0) ? (selfLoopCount / caseCount) * 100 : 0;

        return {
            caseCount: caseCount,
            activityCount: activityCount,
            medianDuration: medianDuration,
            avgDuration: avgDuration,
            selfLoopPct: selfLoopPct,
            variantCount: graphData.variantCount
        };
    }

    // ── Layout Algorithm ────────────────────────────────────────

    /**
     * Break cycles in a directed graph using DFS.
     * Returns a NEW edges array where back-edges are reversed (swap from/to)
     * and flagged with reversed:true. Forward edges get reversed:false.
     * This produces a DAG from a potentially cyclic graph.
     *
     * @param {Array} nodes - Array of node objects with {id, ...}
     * @param {Array} edges - Array of edge objects with {from, to, ...}
     * @returns {Array} New edges array (back-edges reversed, all have reversed property)
     */
    function breakCycles(nodes, edges) {
        // Build adjacency list
        var adj = {};
        var i;
        for (i = 0; i < nodes.length; i++) {
            adj[nodes[i].id] = [];
        }
        for (i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (adj[e.from]) {
                adj[e.from].push(e.to);
            }
        }

        var visited = {};
        var inStack = {};
        var backEdges = {}; // "from->to" keys that are back-edges

        function dfs(nodeId) {
            visited[nodeId] = true;
            inStack[nodeId] = true;
            var neighbors = adj[nodeId] || [];
            for (var ni = 0; ni < neighbors.length; ni++) {
                var neighbor = neighbors[ni];
                if (!visited[neighbor]) {
                    dfs(neighbor);
                } else if (inStack[neighbor]) {
                    // back-edge detected
                    backEdges[nodeId + '->' + neighbor] = true;
                }
            }
            inStack[nodeId] = false;
        }

        // Start DFS from __start__
        if (!visited['__start__']) {
            dfs('__start__');
        }

        // Handle nodes not reachable from __start__
        for (i = 0; i < nodes.length; i++) {
            if (!visited[nodes[i].id]) {
                dfs(nodes[i].id);
            }
        }

        // Build new edges array
        var newEdges = [];
        for (i = 0; i < edges.length; i++) {
            var orig = edges[i];
            var key = orig.from + '->' + orig.to;
            if (backEdges[key]) {
                // Reverse this edge
                var reversed = {};
                for (var prop in orig) {
                    if (orig.hasOwnProperty(prop)) {
                        reversed[prop] = orig[prop];
                    }
                }
                reversed.from = orig.to;
                reversed.to = orig.from;
                reversed.reversed = true;
                newEdges.push(reversed);
            } else {
                var forward = {};
                for (var prop2 in orig) {
                    if (orig.hasOwnProperty(prop2)) {
                        forward[prop2] = orig[prop2];
                    }
                }
                forward.reversed = false;
                newEdges.push(forward);
            }
        }

        return newEdges;
    }

    /**
     * Assign levels (depths) to nodes using longest-path from __start__.
     * Processes nodes in topological order to assign level = max(predecessor levels) + 1.
     * Unreachable nodes get max_level + 1.
     *
     * @param {Array}  nodes   - Array of node objects with {id, ...}
     * @param {Array}  edges   - Array of DAG edges (output of breakCycles)
     * @param {string} startId - The start node id (typically '__start__')
     * @returns {Object} Map of nodeId -> level number
     */
    function assignLevels(nodes, edges, startId) {
        var i;
        // Build predecessor list and adjacency list
        var preds = {};   // nodeId -> array of predecessor nodeIds
        var adj = {};     // nodeId -> array of successor nodeIds
        var inDegree = {};

        for (i = 0; i < nodes.length; i++) {
            var nid = nodes[i].id;
            preds[nid] = [];
            adj[nid] = [];
            inDegree[nid] = 0;
        }

        for (i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (adj[e.from] !== undefined) {
                adj[e.from].push(e.to);
            }
            if (preds[e.to] !== undefined) {
                preds[e.to].push(e.from);
                inDegree[e.to] = (inDegree[e.to] || 0) + 1;
            }
        }

        // Topological sort (Kahn's algorithm)
        var queue = [];
        var levels = {};

        for (i = 0; i < nodes.length; i++) {
            var nid2 = nodes[i].id;
            if (inDegree[nid2] === 0) {
                queue.push(nid2);
                levels[nid2] = 0;
            }
        }

        // Ensure start node is level 0
        levels[startId] = 0;

        var processed = [];
        while (queue.length > 0) {
            var curr = queue.shift();
            processed.push(curr);
            var succs = adj[curr] || [];
            for (var si = 0; si < succs.length; si++) {
                var succ = succs[si];
                // Longest path: level = max(all predecessor levels) + 1
                var predLevel = (levels[curr] !== undefined) ? levels[curr] : 0;
                var newLevel = predLevel + 1;
                if (levels[succ] === undefined || newLevel > levels[succ]) {
                    levels[succ] = newLevel;
                }
                inDegree[succ]--;
                if (inDegree[succ] === 0) {
                    queue.push(succ);
                }
            }
        }

        // Find max level assigned so far
        var maxLevel = 0;
        for (var k in levels) {
            if (levels.hasOwnProperty(k) && levels[k] > maxLevel) {
                maxLevel = levels[k];
            }
        }

        // Assign unreachable nodes to max_level + 1
        for (i = 0; i < nodes.length; i++) {
            var nid3 = nodes[i].id;
            if (levels[nid3] === undefined) {
                levels[nid3] = maxLevel + 1;
            }
        }

        return levels;
    }

    /**
     * Minimize edge crossings by sorting nodes within each level using
     * the barycenter heuristic. Performs 4 passes alternating top-down
     * and bottom-up.
     *
     * @param {Object} levelMap  - Map of nodeId -> level number (from assignLevels)
     * @param {Array}  edges     - Array of DAG edges
     * @param {Array}  nodeIds   - Array of all node ids
     * @returns {Array} levelGroups where levelGroups[level] is an ordered array of nodeIds
     */
    function minimizeCrossings(levelMap, edges, nodeIds) {
        var i;

        // Build levelGroups: array of arrays
        var maxLevel = 0;
        for (i = 0; i < nodeIds.length; i++) {
            var lvl = levelMap[nodeIds[i]];
            if (lvl !== undefined && lvl > maxLevel) {
                maxLevel = lvl;
            }
        }

        var levelGroups = [];
        for (i = 0; i <= maxLevel; i++) {
            levelGroups.push([]);
        }
        for (i = 0; i < nodeIds.length; i++) {
            var nid = nodeIds[i];
            var level = levelMap[nid];
            if (level !== undefined && level >= 0 && level <= maxLevel) {
                levelGroups[level].push(nid);
            }
        }

        // Build adjacency: for each node, which nodes are connected (either direction)
        // We need: for a node at level L, what are its neighbors at level L-1 (predecessors) and L+1 (successors)
        var succMap = {};  // nodeId -> array of successor nodeIds
        var predMap = {};  // nodeId -> array of predecessor nodeIds
        for (i = 0; i < nodeIds.length; i++) {
            succMap[nodeIds[i]] = [];
            predMap[nodeIds[i]] = [];
        }
        for (i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (succMap[e.from] !== undefined) {
                succMap[e.from].push(e.to);
            }
            if (predMap[e.to] !== undefined) {
                predMap[e.to].push(e.from);
            }
        }

        // Helper: get position of nodeId within its level group
        function positionOf(nodeId, group) {
            for (var pi = 0; pi < group.length; pi++) {
                if (group[pi] === nodeId) return pi;
            }
            return 0;
        }

        // Helper: compute barycenter of a node relative to a fixed adjacent level
        function barycenter(nodeId, fixedGroup) {
            var neighbors = [];
            // collect neighbors that appear in fixedGroup
            var allNeighbors = (succMap[nodeId] || []).concat(predMap[nodeId] || []);
            for (var ni = 0; ni < allNeighbors.length; ni++) {
                var nb = allNeighbors[ni];
                for (var fi = 0; fi < fixedGroup.length; fi++) {
                    if (fixedGroup[fi] === nb) {
                        neighbors.push(fi);
                        break;
                    }
                }
            }
            if (neighbors.length === 0) return 0;
            var sum = 0;
            for (var bi = 0; bi < neighbors.length; bi++) {
                sum += neighbors[bi];
            }
            return sum / neighbors.length;
        }

        // 4 passes: even = top-down (fix level L, sort L+1), odd = bottom-up
        for (var pass = 0; pass < 4; pass++) {
            if (pass % 2 === 0) {
                // Top-down: fix level L, sort level L+1 by barycenter
                for (var L = 0; L < levelGroups.length - 1; L++) {
                    var fixedGroup = levelGroups[L];
                    var sortGroup = levelGroups[L + 1];
                    sortGroup.sort(function(a, b) {
                        return barycenter(a, fixedGroup) - barycenter(b, fixedGroup);
                    });
                }
            } else {
                // Bottom-up: fix level L+1, sort level L by barycenter
                for (var L2 = levelGroups.length - 1; L2 > 0; L2--) {
                    var fixedGroup2 = levelGroups[L2];
                    var sortGroup2 = levelGroups[L2 - 1];
                    sortGroup2.sort(function(a, b) {
                        return barycenter(a, fixedGroup2) - barycenter(b, fixedGroup2);
                    });
                }
            }
        }

        return levelGroups;
    }

    /**
     * Assign x,y positions to each node based on level and direction.
     * For top-down: levels are rows (y-axis), nodes spread horizontally (x-axis).
     * For left-right: levels are columns (x-axis), nodes spread vertically (y-axis).
     * Enforces minimum 90px spacing between node centers to prevent overlap.
     *
     * @param {Array}  levelGroups - Ordered arrays of nodeIds per level (from minimizeCrossings)
     * @param {Array}  nodes       - Array of node objects with {id, ...}
     * @param {string} direction   - 'top-down' or 'left-right'
     * @param {number} canvasW     - Canvas width in pixels
     * @param {number} canvasH     - Canvas height in pixels
     * @param {number} kpiReserve  - Pixels reserved for KPI banner (top or left)
     * @returns {Object} { positions: { nodeId: {x, y} }, graphWidth, graphHeight, maxNodesInLevel }
     */
    function assignPositions(levelGroups, nodes, direction, canvasW, canvasH, kpiReserve) {
        var positions = {};
        var i, j;
        var levelCount = levelGroups.length;
        if (levelCount === 0) {
            return { positions: positions, graphWidth: canvasW, graphHeight: canvasH, maxNodesInLevel: 0 };
        }

        // Padding to keep nodes away from edges (room for labels)
        var pad = 50;
        var minNodeSpacing = 90;

        // Find max nodes in any level
        var maxInLevel = 0;
        for (i = 0; i < levelGroups.length; i++) {
            if (levelGroups[i].length > maxInLevel) maxInLevel = levelGroups[i].length;
        }

        if (direction === 'left-right') {
            var availableW = canvasW - pad * 2;
            var availableH = canvasH - kpiReserve - pad * 2;
            var levelSpacingX = Math.max(80, availableW / (levelCount + 1));

            // Ensure minimum spacing — expand height if needed
            var neededH = maxInLevel * minNodeSpacing;
            var useH = Math.max(availableH, neededH);

            for (i = 0; i < levelGroups.length; i++) {
                var group = levelGroups[i];
                var nodeCount = group.length;
                var x = pad + levelSpacingX * (i + 1);
                var nodeSpacingY = useH / (nodeCount + 1);

                for (j = 0; j < group.length; j++) {
                    var nid = group[j];
                    var rowHeight = nodeSpacingY * (nodeCount + 1);
                    var offsetY = kpiReserve + (canvasH - kpiReserve - rowHeight) / 2;
                    var y = offsetY + nodeSpacingY * (j + 1);
                    positions[nid] = { x: x, y: y };
                }
            }

            return {
                positions: positions,
                graphWidth: canvasW,
                graphHeight: canvasH,
                maxNodesInLevel: maxInLevel
            };

        } else {
            var availableH2 = canvasH - kpiReserve - pad * 2;
            var availableW2 = canvasW - pad * 2;
            var levelSpacingY = Math.max(80, availableH2 / (levelCount + 1));

            // Ensure minimum spacing — expand graph width if needed
            var neededW = maxInLevel * minNodeSpacing;
            var useW = Math.max(availableW2, neededW);

            for (i = 0; i < levelGroups.length; i++) {
                var group2 = levelGroups[i];
                var nodeCount2 = group2.length;
                var y2 = kpiReserve + pad + levelSpacingY * (i + 1);
                var nodeSpacingX = useW / (nodeCount2 + 1);

                for (j = 0; j < group2.length; j++) {
                    var nid2 = group2[j];
                    // Center the row within available canvas width
                    var rowWidth = nodeSpacingX * (nodeCount2 + 1);
                    var offsetX = (canvasW - rowWidth) / 2;
                    var x2 = offsetX + nodeSpacingX * (j + 1);
                    positions[nid2] = { x: x2, y: y2 };
                }
            }

            return {
                positions: positions,
                graphWidth: canvasW,
                graphHeight: canvasH,
                maxNodesInLevel: maxInLevel
            };
        }
    }

    /**
     * Find the main path (happy path) through the graph by following
     * the highest-count edge at each step from __start__ to __end__.
     *
     * @param {Array} nodes - Array of node objects
     * @param {Array} edges - Array of edge objects with {from, to, count}
     * @returns {Array} Array of node IDs representing the main path
     */
    function findMainPath(nodes, edges) {
        // Build adjacency: from -> [{to, count}, ...]
        var adj = {};
        var i;
        for (i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (!adj[e.from]) adj[e.from] = [];
            adj[e.from].push({ to: e.to, count: e.count });
        }

        var path = ['__start__'];
        var visited = { '__start__': true };
        var current = '__start__';
        var maxSteps = nodes.length + 1; // safety limit

        for (var step = 0; step < maxSteps; step++) {
            var neighbors = adj[current];
            if (!neighbors || neighbors.length === 0) break;

            // Find highest-count edge to an unvisited node
            var bestTo = null;
            var bestCount = -1;
            for (i = 0; i < neighbors.length; i++) {
                if (!visited[neighbors[i].to] && neighbors[i].count > bestCount) {
                    bestCount = neighbors[i].count;
                    bestTo = neighbors[i].to;
                }
            }

            if (!bestTo) break;
            visited[bestTo] = true;
            path.push(bestTo);
            current = bestTo;

            if (current === '__end__') break;
        }

        // If we didn't reach __end__, append it if it exists
        if (path[path.length - 1] !== '__end__') {
            path.push('__end__');
        }

        return path;
    }

    /**
     * Assign positions for vertical or horizontal linear layout.
     * Main path nodes go in a straight line; side branches offset.
     *
     * @param {Array}  mainPath  - Array of node IDs for the main path
     * @param {Array}  nodes     - All node objects
     * @param {Array}  edges     - All edge objects
     * @param {string} style     - 'vertical' or 'horizontal'
     * @param {number} canvasW   - Canvas width
     * @param {number} canvasH   - Canvas height
     * @param {number} kpiReserve - Pixels reserved for KPI header
     * @returns {Object} { positions, graphWidth, graphHeight, maxNodesInLevel, mainPathSet }
     */
    function assignLinearPositions(mainPath, nodes, edges, style, canvasW, canvasH, kpiReserve) {
        var positions = {};
        var i;
        var pad = 60;

        // Build mainPath set for quick lookup
        var mainPathSet = {};
        for (i = 0; i < mainPath.length; i++) {
            mainPathSet[mainPath[i]] = i; // index in main path
        }

        // Build adjacency maps for side branch placement
        var fromMap = {}; // from -> [{to, count}]
        var toMap = {};   // to -> [{from, count}]
        for (i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (!fromMap[e.from]) fromMap[e.from] = [];
            fromMap[e.from].push({ to: e.to, count: e.count });
            if (!toMap[e.to]) toMap[e.to] = [];
            toMap[e.to].push({ from: e.from, count: e.count });
        }

        if (style === 'vertical') {
            var availH = canvasH - kpiReserve - pad * 2;
            var mainSpacing = Math.max(90, availH / (mainPath.length + 1));
            var centerX = canvasW / 2;

            // Place main path nodes centered vertically
            for (i = 0; i < mainPath.length; i++) {
                var my = kpiReserve + pad + mainSpacing * (i + 1);
                positions[mainPath[i]] = { x: centerX, y: my };
            }

            // Place side branch nodes
            var sideOffset = 150;
            var leftSide = true;
            for (i = 0; i < nodes.length; i++) {
                var nid = nodes[i].id;
                if (mainPathSet[nid] !== undefined) continue; // already placed
                if (positions[nid]) continue;

                // Find which main-path node(s) connect to this side node
                var parentIdx = -1;
                var childIdx = -1;

                // Check incoming edges from main path
                var incoming = toMap[nid] || [];
                for (var ii = 0; ii < incoming.length; ii++) {
                    if (mainPathSet[incoming[ii].from] !== undefined) {
                        var pidx = mainPathSet[incoming[ii].from];
                        if (parentIdx === -1 || pidx > parentIdx) parentIdx = pidx;
                    }
                }
                // Check outgoing edges to main path
                var outgoing = fromMap[nid] || [];
                for (var oi = 0; oi < outgoing.length; oi++) {
                    if (mainPathSet[outgoing[oi].to] !== undefined) {
                        var cidx = mainPathSet[outgoing[oi].to];
                        if (childIdx === -1 || cidx < childIdx) childIdx = cidx;
                    }
                }

                // Place between parent and child on main path, or just after parent
                var yIdx;
                if (parentIdx >= 0 && childIdx >= 0) {
                    yIdx = (parentIdx + childIdx) / 2;
                } else if (parentIdx >= 0) {
                    yIdx = parentIdx + 0.5;
                } else if (childIdx >= 0) {
                    yIdx = childIdx - 0.5;
                } else {
                    yIdx = mainPath.length / 2;
                }

                var sideY = kpiReserve + pad + mainSpacing * (yIdx + 1);
                var sideX = leftSide ? (centerX - sideOffset) : (centerX + sideOffset);
                leftSide = !leftSide; // alternate sides

                positions[nid] = { x: sideX, y: sideY };
            }
        } else {
            // horizontal
            var availW = canvasW - pad * 2;
            var mainSpacingH = Math.max(140, availW / (mainPath.length + 1));
            var centerY = kpiReserve + (canvasH - kpiReserve) / 2;

            // Place main path nodes on horizontal center line
            for (i = 0; i < mainPath.length; i++) {
                var mx = pad + mainSpacingH * (i + 1);
                positions[mainPath[i]] = { x: mx, y: centerY };
            }

            // Place side branch nodes below
            var sideOffsetH = 120;
            var belowToggle = true;
            for (i = 0; i < nodes.length; i++) {
                var nidH = nodes[i].id;
                if (mainPathSet[nidH] !== undefined) continue;
                if (positions[nidH]) continue;

                var parentIdxH = -1;
                var childIdxH = -1;

                var inH = toMap[nidH] || [];
                for (var iih = 0; iih < inH.length; iih++) {
                    if (mainPathSet[inH[iih].from] !== undefined) {
                        var pidxH = mainPathSet[inH[iih].from];
                        if (parentIdxH === -1 || pidxH > parentIdxH) parentIdxH = pidxH;
                    }
                }
                var outH = fromMap[nidH] || [];
                for (var oih = 0; oih < outH.length; oih++) {
                    if (mainPathSet[outH[oih].to] !== undefined) {
                        var cidxH = mainPathSet[outH[oih].to];
                        if (childIdxH === -1 || cidxH < childIdxH) childIdxH = cidxH;
                    }
                }

                var xIdx;
                if (parentIdxH >= 0 && childIdxH >= 0) {
                    xIdx = (parentIdxH + childIdxH) / 2;
                } else if (parentIdxH >= 0) {
                    xIdx = parentIdxH + 0.5;
                } else if (childIdxH >= 0) {
                    xIdx = childIdxH - 0.5;
                } else {
                    xIdx = mainPath.length / 2;
                }

                var sideXH = pad + mainSpacingH * (xIdx + 1);
                var sideYH = belowToggle ? (centerY + sideOffsetH) : (centerY - sideOffsetH);
                belowToggle = !belowToggle;

                positions[nidH] = { x: sideXH, y: sideYH };
            }
        }

        return {
            positions: positions,
            graphWidth: canvasW,
            graphHeight: canvasH,
            maxNodesInLevel: mainPath.length,
            mainPathSet: mainPathSet
        };
    }

    /**
     * Compute node radius proportional to count.
     * Dynamic max radius based on available space per node.
     * Start (__start__) and End (__end__) nodes always return 10.
     *
     * @param {number} count               - This node's count (visit frequency)
     * @param {number} maxCount            - Maximum count among all activity nodes
     * @param {string} nodeId              - The node's id (to detect start/end)
     * @param {number} maxNodesInLevel     - Max nodes in any level (unused, kept for signature compat)
     * @param {number} availableSpacePerNode - Available pixels per node in cross-axis
     * @returns {number} Radius in pixels
     */
    function computeNodeRadius(count, maxCount, nodeId, maxNodesInLevel, availableSpacePerNode) {
        if (nodeId === '__start__' || nodeId === '__end__') {
            return 8;
        }
        // Cap radius based on available space — leave room for labels and edges
        var space = availableSpacePerNode || 80;
        var maxR = Math.min(24, Math.max(10, space * 0.2));
        var minR = Math.max(10, maxR * 0.6);
        if (!maxCount || maxCount <= 0) {
            return minR;
        }
        var ratio = count / maxCount;
        return minR + ratio * (maxR - minR);
    }

    // ── Drawing Helpers ──────────────────────────────────────

    /**
     * Convert a hex color string to rgba(r,g,b,alpha).
     * Handles 3-char (#abc) and 6-char (#aabbcc) hex.
     */
    function hexToRgba(hex, alpha) {
        var r, g, b;
        var clean = hex.replace('#', '');
        if (clean.length === 3) {
            r = parseInt(clean[0] + clean[0], 16);
            g = parseInt(clean[1] + clean[1], 16);
            b = parseInt(clean[2] + clean[2], 16);
        } else {
            r = parseInt(clean.slice(0, 2), 16);
            g = parseInt(clean.slice(2, 4), 16);
            b = parseInt(clean.slice(4, 6), 16);
        }
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    /**
     * Lighten a hex color by mixing toward white.
     * amount is 0-1 (0 = no change, 1 = white).
     */
    function lightenColor(hex, amount) {
        var clean = hex.replace('#', '');
        var r, g, b;
        if (clean.length === 3) {
            r = parseInt(clean[0] + clean[0], 16);
            g = parseInt(clean[1] + clean[1], 16);
            b = parseInt(clean[2] + clean[2], 16);
        } else {
            r = parseInt(clean.slice(0, 2), 16);
            g = parseInt(clean.slice(2, 4), 16);
            b = parseInt(clean.slice(4, 6), 16);
        }
        r = Math.min(255, Math.round(r + (255 - r) * amount));
        g = Math.min(255, Math.round(g + (255 - g) * amount));
        b = Math.min(255, Math.round(b + (255 - b) * amount));
        function toHex(n) {
            var h = n.toString(16);
            return h.length === 1 ? '0' + h : h;
        }
        return '#' + toHex(r) + toHex(g) + toHex(b);
    }

    /**
     * Draw a rounded rectangle path on the canvas context.
     */
    function roundedRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    /**
     * Draw a node at (x, y) with given radius and shape.
     * Handles regular, start, end, and hovered states.
     * shape: 'circle', 'rectangle', or 'diamond'
     */
    function drawNode(ctx, x, y, radius, label, count, color, isStart, isEnd, isHovered, showCount, shape) {
        ctx.save();
        ctx.textAlign = 'center';

        if (isStart || isEnd) {
            // Minimal Start/End markers — always circle
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = isHovered ? '#555' : '#2a2a2a';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = isEnd ? 2 : 1;
            ctx.stroke();
            if (isEnd) {
                ctx.beginPath();
                ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
                ctx.strokeStyle = 'rgba(120,120,120,0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            ctx.fillStyle = 'rgba(180,180,180,0.7)';
            ctx.font = '8px sans-serif';
            ctx.textBaseline = 'top';
            ctx.fillText(isStart ? 'Start' : 'End', x, y + radius + (isEnd ? 5 : 2));
        } else if (shape === 'rectangle') {
            // Rectangle node — readable size, min 100x40
            var rw = Math.max(100, radius * 5);
            var rh = Math.max(40, radius * 2.5);
            var cornerR = 5;
            var rx = x - rw / 2;
            var ry = y - rh / 2;

            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 2;
            roundedRectPath(ctx, rx, ry, rw, rh, cornerR);
            ctx.fillStyle = isHovered ? lightenColor(color, 0.3) : color;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)';
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.stroke();

            // Count on first line (bold), label on second line
            if (showCount && count !== undefined && count !== null) {
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.font = 'bold 13px monospace';
                ctx.textBaseline = 'middle';
                ctx.fillText(formatCount(count), x, y - 7);
            }
            var truncated = truncateText(label, 20);
            ctx.font = '10px sans-serif';
            var maxLabelW = rw - 10;
            while (ctx.measureText(truncated).width > maxLabelW) {
                truncated = truncateText(label, truncated.length - 2);
                if (truncated.length <= 3) break;
            }
            ctx.fillStyle = 'rgba(230,230,230,0.9)';
            ctx.textBaseline = 'middle';
            ctx.fillText(truncated, x, y + 8);

        } else if (shape === 'diamond') {
            // Diamond — elongated, readable
            var dW = Math.max(70, radius * 4);
            var dH = Math.max(35, radius * 2);
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - dH / 2);
            ctx.lineTo(x + dW / 2, y);
            ctx.lineTo(x, y + dH / 2);
            ctx.lineTo(x - dW / 2, y);
            ctx.closePath();
            ctx.fillStyle = isHovered ? lightenColor(color, 0.3) : color;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)';
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.stroke();

            if (showCount && count !== undefined && count !== null) {
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.font = 'bold 12px monospace';
                ctx.textBaseline = 'middle';
                ctx.fillText(formatCount(count), x, y - 6);
            }
            var dTrunc = truncateText(label, 14);
            ctx.font = '9px sans-serif';
            ctx.fillStyle = 'rgba(230,230,230,0.9)';
            ctx.textBaseline = 'middle';
            ctx.fillText(dTrunc, x, y + 8);

        } else {
            // Circle node (default / fallback)
            ctx.shadowColor = 'rgba(0,0,0,0.2)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetY = 1;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = isHovered ? lightenColor(color, 0.3) : color;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)';
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.stroke();

            // Count inside node (formatted for large numbers)
            if (showCount && count !== undefined && count !== null) {
                var countStr = formatCount(count);
                var ccSize = Math.max(8, Math.min(14, radius * 0.7));
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.font = 'bold ' + ccSize + 'px monospace';
                ctx.textBaseline = 'middle';
                ctx.fillText(countStr, x, y);
            }

            // Label below — auto-sized
            var cTruncated = truncateText(label, 18);
            var clSize = Math.max(7, Math.min(10, radius * 0.5));
            ctx.font = clSize + 'px sans-serif';
            var cMaxLabelW = radius * 3;
            while (clSize > 6 && ctx.measureText(cTruncated).width > cMaxLabelW) {
                clSize--;
                ctx.font = clSize + 'px sans-serif';
            }
            ctx.fillStyle = 'rgba(220,220,220,0.85)';
            ctx.textBaseline = 'top';
            ctx.fillText(cTruncated, x, y + radius + 2);
        }

        ctx.restore();
    }

    /**
     * Draw a directed edge (with arrowhead) between two node circles.
     * Optionally draws animated "marching ants" dashes on top to show flow direction.
     */
    function drawEdge(ctx, fromX, fromY, toX, toY, fromR, toR, count, color, thickness, isHovered, showLabel, isSelfLoop, animate, animOffset, curveOffset, arrowSize, loopSizeMultiplier) {
        ctx.save();

        var aSize = (arrowSize !== undefined && arrowSize !== null) ? parseInt(arrowSize, 10) : 6;
        var loopMult = loopSizeMultiplier || 1;
        var strokeColor = isHovered ? lightenColor(color, 0.4) : color;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isHovered ? thickness + 1 : thickness;
        ctx.fillStyle = strokeColor;

        if (isSelfLoop) {
            // Loop arc — size controlled by loopMult
            var baseLoopR = Math.max(12, fromR * 0.6);
            var loopR = baseLoopR * loopMult;
            var loopX = fromX + fromR * 0.5 + loopR * 0.3;
            var loopY = fromY - fromR * 0.5 - loopR * 0.3;
            ctx.beginPath();
            ctx.arc(loopX, loopY, loopR, 0.4, 2 * Math.PI - 0.4);
            ctx.stroke();

            if (aSize > 0) {
                var arrowAngle = Math.PI * 0.65;
                drawArrowhead(ctx, loopX - loopR * Math.cos(0.4), loopY + loopR * Math.sin(0.4), arrowAngle, aSize, strokeColor);
            }

            if (animate) {
                ctx.save();
                ctx.setLineDash([4, 8]);
                ctx.lineDashOffset = -(animOffset || 0);
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(loopX, loopY, loopR, 0.4, 2 * Math.PI - 0.4);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            if (showLabel && count !== undefined) {
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                var loopFontSize = Math.max(9, Math.min(12, loopR * 0.4));
                ctx.font = 'bold ' + loopFontSize + 'px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(formatCount(count), loopX, loopY - loopR - 3);
            }

        } else {
            // Calculate unit vector from -> to
            var dx = toX - fromX;
            var dy = toY - fromY;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) {
                ctx.restore();
                return;
            }
            var ux = dx / dist;
            var uy = dy / dist;

            // Start/end on circle edges
            var sx = fromX + ux * fromR;
            var sy = fromY + uy * fromR;
            var ex = toX - ux * toR;
            var ey = toY - uy * toR;

            // Perpendicular offset for bezier control point
            var perpX = -uy;
            var perpY = ux;
            var curvature;
            if (curveOffset !== undefined && curveOffset !== null && curveOffset !== 0) {
                curvature = curveOffset;
            } else {
                curvature = Math.min(dist * 0.1, 20);
            }
            var cx = (sx + ex) / 2 + perpX * curvature;
            var cy = (sy + ey) / 2 + perpY * curvature;

            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.quadraticCurveTo(cx, cy, ex, ey);
            ctx.stroke();

            // Arrowhead angle at end of bezier (from control point toward end)
            if (aSize > 0) {
                var arrowDx = ex - cx;
                var arrowDy = ey - cy;
                var angle = Math.atan2(arrowDy, arrowDx);
                drawArrowhead(ctx, ex, ey, angle, aSize, strokeColor);
            }

            if (animate) {
                ctx.save();
                ctx.setLineDash([4, 8]);
                ctx.lineDashOffset = -(animOffset || 0);
                ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.quadraticCurveTo(cx, cy, ex, ey);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            // Edge count label at bezier midpoint t=0.5
            if (showLabel && count !== undefined) {
                var midX = 0.25 * sx + 0.5 * cx + 0.25 * ex;
                var midY = 0.25 * sy + 0.5 * cy + 0.25 * ey;
                ctx.save();
                // Small pill background
                var labelText = formatCount(count);
                ctx.font = 'bold 9px monospace';
                var tw = ctx.measureText(labelText).width;
                var pw = tw + 6;
                var ph = 13;
                ctx.fillStyle = 'rgba(30,30,30,0.75)';
                ctx.beginPath();
                ctx.moveTo(midX - pw / 2 + 3, midY - ph / 2);
                ctx.arcTo(midX + pw / 2, midY - ph / 2, midX + pw / 2, midY + ph / 2, 3);
                ctx.arcTo(midX + pw / 2, midY + ph / 2, midX - pw / 2, midY + ph / 2, 3);
                ctx.arcTo(midX - pw / 2, midY + ph / 2, midX - pw / 2, midY - ph / 2, 3);
                ctx.arcTo(midX - pw / 2, midY - ph / 2, midX + pw / 2, midY - ph / 2, 3);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(labelText, midX, midY);
                ctx.restore();
            }

            // Draggable midpoint indicator (shown on hover)
            if (isHovered) {
                var handleX = 0.25 * sx + 0.5 * cx + 0.25 * ex;
                var handleY = 0.25 * sy + 0.5 * cy + 0.25 * ey;
                ctx.beginPath();
                ctx.arc(handleX, handleY, 4, 0, 2 * Math.PI);
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    /**
     * Draw a filled triangle arrowhead pointing in direction `angle`.
     */
    function drawArrowhead(ctx, x, y, angle, size, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size / 2);
        ctx.lineTo(-size, size / 2);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }

    /**
     * Draw 6 KPIs evenly across the top 60px of the canvas.
     */
    function drawKPIHeader(ctx, kpis, w, kpiColor) {
        var labels = ['Cases', 'Activities', 'Median Duration', 'Avg Duration', 'Self-loop %', 'Variants'];
        var values = [
            formatCount(kpis.caseCount),
            formatCount(kpis.activityCount),
            formatDuration(kpis.medianDuration),
            formatDuration(kpis.avgDuration),
            kpis.selfLoopPct.toFixed(1) + '%',
            formatCount(kpis.variantCount)
        ];

        var colW = w / labels.length;
        ctx.save();

        // Subtle separator line
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 54);
        ctx.lineTo(w, 54);
        ctx.stroke();

        for (var i = 0; i < labels.length; i++) {
            var cx = colW * i + colW / 2;

            // Label
            ctx.fillStyle = 'rgba(160,160,160,0.7)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(labels[i], cx, 6);

            // Value
            ctx.fillStyle = kpiColor;
            ctx.font = 'bold 18px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(values[i], cx, 24);
        }

        ctx.restore();
    }

    /**
     * Draw a tooltip with a rounded dark background and white text lines.
     * Position is clamped to stay within canvas bounds.
     */
    function drawTooltip(ctx, x, y, lines, canvasW, canvasH) {
        if (!lines || lines.length === 0) return;
        ctx.save();

        var padding = 8;
        var lineHeight = 18;
        var fontSize = 14;
        ctx.font = fontSize + 'px sans-serif';

        // Measure widest line
        var maxTextW = 0;
        for (var i = 0; i < lines.length; i++) {
            var w = ctx.measureText(lines[i]).width;
            if (w > maxTextW) maxTextW = w;
        }

        var boxW = maxTextW + padding * 2;
        var boxH = lines.length * lineHeight + padding * 2;

        // Offset tooltip from cursor
        var bx = x + 12;
        var by = y - boxH / 2;

        // Clamp to canvas bounds
        if (bx + boxW > canvasW) bx = x - boxW - 12;
        if (bx < 0) bx = 0;
        if (by < 0) by = 0;
        if (by + boxH > canvasH) by = canvasH - boxH;

        // Rounded rect background
        var radius = 6;
        ctx.beginPath();
        ctx.moveTo(bx + radius, by);
        ctx.lineTo(bx + boxW - radius, by);
        ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + radius);
        ctx.lineTo(bx + boxW, by + boxH - radius);
        ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - radius, by + boxH);
        ctx.lineTo(bx + radius, by + boxH);
        ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - radius);
        ctx.lineTo(bx, by + radius);
        ctx.quadraticCurveTo(bx, by, bx + radius, by);
        ctx.closePath();
        ctx.fillStyle = 'rgba(30,30,30,0.88)';
        ctx.fill();

        // Text lines
        ctx.fillStyle = '#ffffff';
        ctx.font = fontSize + 'px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (var j = 0; j < lines.length; j++) {
            ctx.fillText(lines[j], bx + padding, by + padding + j * lineHeight);
        }

        ctx.restore();
    }

    // ── Interaction Helpers ─────────────────────────────────────

    function pointInCircle(px, py, cx, cy, r) {
        var dx = px - cx;
        var dy = py - cy;
        return dx * dx + dy * dy <= r * r;
    }

    /**
     * Hit-test a point against a node, considering its shape.
     * shape: 'circle', 'rectangle', 'diamond', or undefined (circle fallback)
     */
    function pointInNode(px, py, nx, ny, r, shape) {
        if (shape === 'rectangle') {
            var rw = Math.max(100, r * 5);
            var rh = Math.max(40, r * 2.5);
            return px >= nx - rw / 2 && px <= nx + rw / 2 && py >= ny - rh / 2 && py <= ny + rh / 2;
        } else if (shape === 'diamond') {
            var dW = Math.max(70, r * 4) / 2;
            var dH = Math.max(35, r * 2) / 2;
            // Diamond hit: |dx/dW| + |dy/dH| <= 1
            var dx = Math.abs(px - nx) / dW;
            var dy = Math.abs(py - ny) / dH;
            return (dx + dy) <= 1;
        }
        return pointInCircle(px, py, nx, ny, r);
    }

    function bezierPoint(t, p0, p1, p2) {
        var mt = 1 - t;
        return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
    }

    function pointNearBezier(px, py, x1, y1, cpx, cpy, x2, y2, threshold) {
        for (var i = 0; i <= 20; i++) {
            var t = i / 20;
            var bx = bezierPoint(t, x1, cpx, x2);
            var by = bezierPoint(t, y1, cpy, y2);
            var dx = px - bx;
            var dy = py - by;
            if (dx * dx + dy * dy <= threshold * threshold) {
                return true;
            }
        }
        return false;
    }

    function screenToWorld(sx, sy, tx, ty, scale, offsetY) {
        return {
            x: (sx - tx) / scale,
            y: (sy - ty - offsetY) / scale
        };
    }

    function drawZoomButton(ctx, x, y, size, label) {
        ctx.save();
        ctx.fillStyle = 'rgba(50, 50, 50, 0.7)';
        ctx.beginPath();
        var r = 4;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + size - r, y);
        ctx.arcTo(x + size, y, x + size, y + r, r);
        ctx.lineTo(x + size, y + size - r);
        ctx.arcTo(x + size, y + size, x + size - r, y + size, r);
        ctx.lineTo(x + r, y + size);
        ctx.arcTo(x, y + size, x, y + size - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + size / 2, y + size / 2);
        ctx.restore();
    }

    // ── Visualization Class ─────────────────────────────────────

    return SplunkVisualizationBase.extend({

        initialize: function() {
            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.el.classList.add('process-mining-viz');

            // Create canvas
            this.canvas = document.createElement('canvas');
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.el.appendChild(this.canvas);

            // State
            this._lastGoodData  = null;
            this._tx            = 0;
            this._ty            = 0;
            this._scale         = 1;
            this._hitNodes      = [];
            this._hitEdges      = [];
            this._hoverItem     = null;
            this._isPanning     = false;
            this._panStartX     = 0;
            this._panStartY     = 0;
            this._panStartTx    = 0;
            this._panStartTy    = 0;
            this._kpiReserve    = 0;
            this._hitButtons    = [];
            this._drilldownField = null;
            // Drag state
            this._isDragging    = false;
            this._dragNodeId    = null;
            this._didDrag       = false;
            this._draggedPositions = {}; // nodeId -> {x, y} overrides
            this._savedPosLoaded = false;
            // Edge drag state
            this._isDraggingEdge = false;
            this._dragEdgeKey    = null; // "from->to"
            this._draggedEdgeOffsets = {}; // "from->to" -> curveOffset number
            // Animation state
            this._animOffset    = 0;
            this._animTimer     = null;
            this._animateFlow   = 'hover'; // default matches formatter

            var self = this;

            this._onWheel = function(e) {
                e.preventDefault();
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                var zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
                var newScale = Math.max(0.1, Math.min(5, self._scale * zoomFactor));
                // Zoom toward mouse position
                self._tx = mx - (mx - self._tx) * (newScale / self._scale);
                self._ty = my - (my - self._ty) * (newScale / self._scale);
                self._scale = newScale;
                self.invalidateUpdateView();
            };

            this._onMouseDown = function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;
                self._didDrag = false;
                // Skip if over a zoom button
                if (self._hitButtons) {
                    for (var bi = 0; bi < self._hitButtons.length; bi++) {
                        var btn = self._hitButtons[bi];
                        if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) return;
                    }
                }
                // Check if over a node — start dragging
                var kpiR = self._kpiReserve || 0;
                var worldCoord = screenToWorld(mx, my, self._tx, self._ty, self._scale, kpiR);
                var foundNode = false;
                for (var ni = 0; ni < self._hitNodes.length; ni++) {
                    var nd = self._hitNodes[ni];
                    if (pointInNode(worldCoord.x, worldCoord.y, nd.x, nd.y, nd.r, nd.shape)) {
                        self._isDragging = true;
                        self._dragNodeId = nd.id;
                        self.canvas.style.cursor = 'grabbing';
                        foundNode = true;
                        return;
                    }
                }
                // Check edges for dragging (midpoint handle)
                if (!foundNode) {
                    var wx = worldCoord.x;
                    var wy = worldCoord.y;
                    for (var edgi = 0; edgi < self._hitEdges.length; edgi++) {
                        var he = self._hitEdges[edgi];
                        if (he.isSelfLoop) continue;
                        if (he.cpx !== undefined) {
                            var emidX = 0.25 * he.sx + 0.5 * he.cpx + 0.25 * he.ex;
                            var emidY = 0.25 * he.sy + 0.5 * he.cpy + 0.25 * he.ey;
                            if (Math.abs(wx - emidX) < 12 && Math.abs(wy - emidY) < 12) {
                                self._isDraggingEdge = true;
                                self._dragEdgeKey = he.from + '->' + he.to;
                                self._didDrag = true;
                                self.canvas.style.cursor = 'ns-resize';
                                return;
                            }
                        }
                    }
                }
                // Start panning
                self._isPanning = true;
                self._panStartX = mx;
                self._panStartY = my;
                self._panStartTx = self._tx;
                self._panStartTy = self._ty;
            };

            this._onMouseMove = function(e) {
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                // Handle node dragging
                if (self._isDragging && self._dragNodeId) {
                    self._didDrag = true;
                    var kpiR2 = self._kpiReserve || 0;
                    var worldPos = screenToWorld(mx, my, self._tx, self._ty, self._scale, kpiR2);
                    self._draggedPositions[self._dragNodeId] = { x: worldPos.x, y: worldPos.y };
                    self.canvas.style.cursor = 'grabbing';
                    self.invalidateUpdateView();
                    return;
                }

                // Handle edge dragging
                if (self._isDraggingEdge && self._dragEdgeKey) {
                    self._didDrag = true;
                    var kpiR3 = self._kpiReserve || 0;
                    var edgeWorld = screenToWorld(mx, my, self._tx, self._ty, self._scale, kpiR3);
                    var ewx = edgeWorld.x;
                    var ewy = edgeWorld.y;
                    for (var dei = 0; dei < self._hitEdges.length; dei++) {
                        var de = self._hitEdges[dei];
                        if ((de.from + '->' + de.to) === self._dragEdgeKey && !de.isSelfLoop && de.sx !== undefined) {
                            var lineDx = de.ex - de.sx;
                            var lineDy = de.ey - de.sy;
                            var lineLen = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
                            if (lineLen > 0) {
                                var perpDist = ((ewx - de.sx) * (-lineDy / lineLen) + (ewy - de.sy) * (lineDx / lineLen));
                                self._draggedEdgeOffsets[self._dragEdgeKey] = perpDist;
                            }
                            break;
                        }
                    }
                    self.invalidateUpdateView();
                    return;
                }

                if (self._isPanning) {
                    self._tx = self._panStartTx + (mx - self._panStartX);
                    self._ty = self._panStartTy + (my - self._panStartY);
                    self.invalidateUpdateView();
                    return;
                }

                // Hit-test nodes and edges in world coords
                var kpiReserve = self._kpiReserve || 0;
                var world = screenToWorld(mx, my, self._tx, self._ty, self._scale, kpiReserve);
                var wx = world.x;
                var wy = world.y;

                var found = null;

                // Check nodes first (higher priority)
                for (var i = 0; i < self._hitNodes.length; i++) {
                    var n = self._hitNodes[i];
                    if (pointInNode(wx, wy, n.x, n.y, n.r, n.shape)) {
                        var tooltipLines = [n.name, 'Count: ' + n.count];
                        // Add top status
                        var topStatus = null, topCount = 0;
                        for (var sk in n.statuses) {
                            if (n.statuses.hasOwnProperty(sk) && n.statuses[sk] > topCount) {
                                topCount = n.statuses[sk];
                                topStatus = sk;
                            }
                        }
                        if (topStatus) tooltipLines.push('Status: ' + topStatus);
                        // Add top resources (up to 3)
                        var resArr = [];
                        for (var rk in n.resources) {
                            if (n.resources.hasOwnProperty(rk)) resArr.push({ name: rk, count: n.resources[rk] });
                        }
                        resArr.sort(function(a, b) { return b.count - a.count; });
                        if (resArr.length > 0) {
                            var resNames = [];
                            for (var ri = 0; ri < Math.min(3, resArr.length); ri++) {
                                resNames.push(resArr[ri].name);
                            }
                            tooltipLines.push('Resources: ' + resNames.join(', '));
                        }
                        found = { type: 'node', id: n.id, mouseX: mx, mouseY: my, tooltipLines: tooltipLines };
                        break;
                    }
                }

                // Check edges if no node found
                if (!found) {
                    for (var j = 0; j < self._hitEdges.length; j++) {
                        var edge = self._hitEdges[j];
                        var edgeHit = false;
                        if (edge.isSelfLoop) {
                            // Use stored self-loop geometry (matches drawEdge)
                            if (edge.loopR && pointInCircle(wx, wy, edge.loopX, edge.loopY, edge.loopR + 6)) {
                                edgeHit = true;
                            }
                        } else if (edge.cpx !== undefined) {
                            // Use stored bezier geometry (matches drawEdge)
                            if (pointNearBezier(wx, wy, edge.sx, edge.sy, edge.cpx, edge.cpy, edge.ex, edge.ey, 6)) {
                                edgeHit = true;
                            }
                        }
                        if (edgeHit) {
                            var dur = edge.durations.length > 0 ? formatDuration(median(edge.durations)) : 'N/A';
                            found = { type: 'edge', from: edge.from, to: edge.to, mouseX: mx, mouseY: my,
                                tooltipLines: [edge.from + ' \u2192 ' + edge.to, 'Count: ' + edge.count, 'Median duration: ' + dur] };
                            break;
                        }
                    }
                }

                self._hoverItem = found;
                var cursor = 'default';
                if (found && found.type === 'node') {
                    cursor = 'grab';
                } else if (found && found.type === 'edge') {
                    // Check if near edge midpoint — show resize cursor
                    var hoverKpiR = self._kpiReserve || 0;
                    var hoverWorld = screenToWorld(mx, my, self._tx, self._ty, self._scale, hoverKpiR);
                    var hwx = hoverWorld.x;
                    var hwy = hoverWorld.y;
                    var nearMid = false;
                    for (var hei = 0; hei < self._hitEdges.length; hei++) {
                        var hhe = self._hitEdges[hei];
                        if (hhe.from === found.from && hhe.to === found.to && !hhe.isSelfLoop && hhe.cpx !== undefined) {
                            var hmidX = 0.25 * hhe.sx + 0.5 * hhe.cpx + 0.25 * hhe.ex;
                            var hmidY = 0.25 * hhe.sy + 0.5 * hhe.cpy + 0.25 * hhe.ey;
                            if (Math.abs(hwx - hmidX) < 12 && Math.abs(hwy - hmidY) < 12) {
                                nearMid = true;
                            }
                            break;
                        }
                    }
                    cursor = nearMid ? 'ns-resize' : 'pointer';
                } else if (self._isPanning) {
                    cursor = 'grabbing';
                }
                self.canvas.style.cursor = cursor;
                self.invalidateUpdateView();
            };

            this._onMouseUp = function() {
                self._isPanning = false;
                self._isDragging = false;
                self._dragNodeId = null;
                self._isDraggingEdge = false;
                self._dragEdgeKey = null;
            };

            this._onClick = function(e) {
                // Skip drilldown if we just finished dragging a node
                if (self._didDrag) {
                    self._didDrag = false;
                    return;
                }
                if (!self._hitNodes || self._hitNodes.length === 0) return;
                var rect = self.canvas.getBoundingClientRect();
                var mx = e.clientX - rect.left;
                var my = e.clientY - rect.top;

                // Check zoom buttons first
                if (self._hitButtons) {
                    for (var b = 0; b < self._hitButtons.length; b++) {
                        var btn = self._hitButtons[b];
                        if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
                            if (btn.action === 'zoomIn') {
                                self._scale = Math.min(5, self._scale * 1.3);
                            } else if (btn.action === 'zoomOut') {
                                self._scale = Math.max(0.1, self._scale * 0.7);
                            } else if (btn.action === 'fitToView') {
                                self._tx = 0;
                                self._ty = 0;
                                self._scale = 1;
                                self._draggedPositions = {};
                                self._draggedEdgeOffsets = {};
                                self._savedPosLoaded = false;
                            }
                            self.invalidateUpdateView();
                            return;
                        }
                    }
                }

                // Check nodes for drilldown
                var kpiReserve = self._kpiReserve || 0;
                var world = screenToWorld(mx, my, self._tx, self._ty, self._scale, kpiReserve);
                for (var i = 0; i < self._hitNodes.length; i++) {
                    var n = self._hitNodes[i];
                    if (n.id === '__start__' || n.id === '__end__') continue;
                    if (pointInNode(world.x, world.y, n.x, n.y, n.r, n.shape)) {
                        var drilldownData = {};
                        drilldownData[self._drilldownField] = n.name;
                        e.preventDefault();
                        self.drilldown({
                            action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                            data: drilldownData
                        }, e);
                        break;
                    }
                }
            };

            this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
            this.canvas.addEventListener('mousedown', this._onMouseDown);
            this.canvas.addEventListener('mousemove', this._onMouseMove);
            this.canvas.addEventListener('mouseup', this._onMouseUp);
            this.canvas.addEventListener('click', this._onClick);
        },

        getInitialDataParams: function() {
            return {
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 10000
            };
        },

        formatData: function(data) {
            // NOTE: never read config here — only in updateView
            if (!data || !data.rows || data.rows.length === 0) {
                if (this._lastGoodData) return this._lastGoodData;
                throw new SplunkVisualizationBase.VisualizationError(
                    'Awaiting data \u2014 Process Mining'
                );
            }

            var fields = data.fields;
            var colIdx = {};
            for (var i = 0; i < fields.length; i++) {
                colIdx[fields[i].name] = i;
            }

            var result = {
                colIdx: colIdx,
                rows:   data.rows
            };
            this._lastGoodData = result;
            return result;
        },

        updateView: function(data, config) {
            // 1. Data fallback
            if (!data) {
                if (this._lastGoodData) { data = this._lastGoodData; }
                else { return; }
            }

            // 2. Read ALL config settings with defaults matching formatter.html
            var ns = this.getPropertyNamespaceInfo().propertyNamespace;
            var caseField = config[ns + 'caseField'] || 'case_id';
            var activityField = config[ns + 'activityField'] || 'activity';
            var timeField = config[ns + 'timeField'] || '_time';
            var statusField = config[ns + 'statusField'] || 'status';
            var resourceField = config[ns + 'resourceField'] || 'resource';
            var layoutDirection = config[ns + 'layoutDirection'] || 'vertical';
            var nodeShapeSetting = config[ns + 'nodeShape'] || 'rectangle';
            var shapeFieldName = config[ns + 'shapeField'] || 'shape';
            var nodeColor = config[ns + 'nodeColor'] || '#607d8b';
            var edgeColor = config[ns + 'edgeColor'] || '#90a4ae';
            var successColor = config[ns + 'successColor'] || '#4caf50';
            var errorColor = config[ns + 'errorColor'] || '#f44336';
            var showKPIs = (config[ns + 'showKPIs'] || 'true') === 'true';
            var kpiColor = config[ns + 'kpiColor'] || '#00bcd4';
            var showEdgeLabels = (config[ns + 'showEdgeLabels'] || 'true') === 'true';
            var showNodeCounts = (config[ns + 'showNodeCounts'] || 'true') === 'true';
            var animateFlow = config[ns + 'animateFlow'] || 'hover';
            this._animateFlow = animateFlow;
            this._drilldownField = config[ns + 'drilldownField'] || 'activity';
            var arrowSize = parseInt(config[ns + 'arrowSize'] || '6', 10);
            var loopSizeSetting = config[ns + 'loopSize'] || 'medium';
            var loopSizeMultiplier = loopSizeSetting === 'small' ? 0.6 : loopSizeSetting === 'large' ? 1.6 : loopSizeSetting === 'xlarge' ? 2.4 : 1;

            // 3. Size canvas for HiDPI
            var el = this.el;
            var rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            var dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            var ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.scale(dpr, dpr);
            var w = rect.width;
            var h = rect.height;

            // 4. Clear canvas
            ctx.clearRect(0, 0, w, h);

            // 5. Build process graph
            var graph = buildProcessGraph(data.rows, data.colIdx, caseField, activityField, timeField, statusField, resourceField, shapeFieldName);

            // 6. KPIs
            var kpis = computeKPIs(graph);
            var kpiReserve = showKPIs ? 60 : 0;
            this._kpiReserve = kpiReserve;
            if (showKPIs) {
                drawKPIHeader(ctx, kpis, w, kpiColor);
            }

            // 7. Layout
            var layout;
            var mainPathSet = null;
            if (layoutDirection === 'freeform') {
                // Existing Sugiyama pipeline
                var dagEdges = breakCycles(graph.nodes, graph.edges);
                var levelMap = assignLevels(graph.nodes, dagEdges, '__start__');
                var nodeIds = [];
                for (var ni = 0; ni < graph.nodes.length; ni++) {
                    nodeIds.push(graph.nodes[ni].id);
                }
                var levelGroups = minimizeCrossings(levelMap, dagEdges, nodeIds);
                layout = assignPositions(levelGroups, graph.nodes, 'top-down', w, h, kpiReserve);
            } else {
                // Linear layout (vertical or horizontal)
                var mainPath = findMainPath(graph.nodes, graph.edges);
                layout = assignLinearPositions(mainPath, graph.nodes, graph.edges, layoutDirection, w, h, kpiReserve);
                mainPathSet = layout.mainPathSet || null;
            }

            // 7b. Load saved positions from config (if any)
            var savedPosStr = config[ns + 'savedPositions'] || '';
            if (savedPosStr && !this._savedPosLoaded) {
                try {
                    var saved = JSON.parse(savedPosStr);
                    // Support new format: { nodes: {nodeId: {x,y}}, edges: {"from->to": offset} }
                    // and old format (flat): { nodeId: {x,y} }
                    if (saved.nodes || saved.edges) {
                        var savedNodes = saved.nodes || {};
                        var savedEdges = saved.edges || {};
                        for (var spk in savedNodes) {
                            if (savedNodes.hasOwnProperty(spk) && !this._draggedPositions[spk]) {
                                this._draggedPositions[spk] = savedNodes[spk];
                            }
                        }
                        for (var sek in savedEdges) {
                            if (savedEdges.hasOwnProperty(sek) && this._draggedEdgeOffsets[sek] === undefined) {
                                this._draggedEdgeOffsets[sek] = savedEdges[sek];
                            }
                        }
                    } else {
                        // Old flat format — only node positions
                        for (var spk2 in saved) {
                            if (saved.hasOwnProperty(spk2) && !this._draggedPositions[spk2]) {
                                this._draggedPositions[spk2] = saved[spk2];
                            }
                        }
                    }
                } catch(e) {}
                this._savedPosLoaded = true;
            }

            // 7c. Apply user-dragged position overrides
            for (var dp in this._draggedPositions) {
                if (this._draggedPositions.hasOwnProperty(dp) && layout.positions[dp]) {
                    layout.positions[dp] = this._draggedPositions[dp];
                }
            }

            // 8. Compute max count for radius scaling
            var maxCount = 0;
            for (var mc = 0; mc < graph.nodes.length; mc++) {
                if (graph.nodes[mc].count > maxCount) maxCount = graph.nodes[mc].count;
            }

            // 8b. Compute available space per node for dynamic radius
            var spacePerNode;
            if (layoutDirection === 'vertical') {
                spacePerNode = (h - kpiReserve) / (layout.maxNodesInLevel + 1);
            } else if (layoutDirection === 'horizontal') {
                spacePerNode = w / (layout.maxNodesInLevel + 1);
            } else {
                // freeform uses top-down logic
                spacePerNode = w / (layout.maxNodesInLevel + 1);
            }

            // 8c. Manage animation timer
            var self = this;
            var needsTimer = (animateFlow === 'always') ||
                (animateFlow === 'hover' && this._hoverItem && this._hoverItem.type === 'node');
            if (needsTimer && !this._animTimer) {
                this._animTimer = setInterval(function() {
                    self._animOffset = (self._animOffset + 1) % 120;
                    // Only keep animating if still needed
                    var stillNeeds = (self._animateFlow === 'always') ||
                        (self._animateFlow === 'hover' && self._hoverItem && self._hoverItem.type === 'node');
                    if (!stillNeeds) {
                        clearInterval(self._animTimer);
                        self._animTimer = null;
                    } else {
                        self.invalidateUpdateView();
                    }
                }, 33); // ~30fps
            } else if (!needsTimer && this._animTimer) {
                clearInterval(this._animTimer);
                this._animTimer = null;
            }

            // 9. Build node lookup
            var nodeById = {};
            for (var nb = 0; nb < graph.nodes.length; nb++) {
                nodeById[graph.nodes[nb].id] = graph.nodes[nb];
            }

            // 10. Apply zoom/pan transform
            ctx.save();
            ctx.translate(this._tx, this._ty + kpiReserve);
            ctx.scale(this._scale, this._scale);

            // 11. Compute edge thickness range
            var maxEdgeCount = 0;
            for (var ec = 0; ec < graph.edges.length; ec++) {
                if (graph.edges[ec].count > maxEdgeCount) maxEdgeCount = graph.edges[ec].count;
            }

            // 12. Store hit data for interactions
            this._hitNodes = [];
            this._hitEdges = [];

            // 13. Auto-spacing: group edges by level pair to avoid overlapping
            var edgeGroups = {}; // "fromLevel-toLevel" -> [edgeIndex, ...]
            if (mainPathSet && layoutDirection !== 'freeform') {
                for (var eg = 0; eg < graph.edges.length; eg++) {
                    var egEdge = graph.edges[eg];
                    if (egEdge.from === egEdge.to) continue; // skip self-loops
                    var fromLvl = mainPathSet[egEdge.from] !== undefined ? mainPathSet[egEdge.from] : -1;
                    var toLvl = mainPathSet[egEdge.to] !== undefined ? mainPathSet[egEdge.to] : -1;
                    var lvlKey = Math.min(fromLvl, toLvl) + '-' + Math.max(fromLvl, toLvl);
                    if (!edgeGroups[lvlKey]) edgeGroups[lvlKey] = [];
                    edgeGroups[lvlKey].push(eg);
                }
            }

            // Compute auto offset for each edge index
            var edgeAutoOffset = {}; // edgeIndex -> offset
            for (var gk in edgeGroups) {
                if (edgeGroups.hasOwnProperty(gk)) {
                    var egGroup = edgeGroups[gk];
                    if (egGroup.length <= 1) continue; // no spacing needed
                    var egSpacing = 25;
                    var egTotalWidth = (egGroup.length - 1) * egSpacing;
                    for (var gi = 0; gi < egGroup.length; gi++) {
                        edgeAutoOffset[egGroup[gi]] = -egTotalWidth / 2 + gi * egSpacing;
                    }
                }
            }

            // Draw edges (behind nodes)
            var hoveredNodeId = (this._hoverItem && this._hoverItem.type === 'node') ? this._hoverItem.id : null;
            for (var ei = 0; ei < graph.edges.length; ei++) {
                var edge = graph.edges[ei];
                var fromPos = layout.positions[edge.from];
                var toPos = layout.positions[edge.to];
                if (!fromPos || !toPos) continue;
                var fromNode = nodeById[edge.from];
                var toNode = nodeById[edge.to];
                var fromR = computeNodeRadius(fromNode ? fromNode.count : 0, maxCount, edge.from, layout.maxNodesInLevel, spacePerNode);
                var toR = computeNodeRadius(toNode ? toNode.count : 0, maxCount, edge.to, layout.maxNodesInLevel, spacePerNode);
                var isSelfLoop = edge.from === edge.to;
                var isHoveredEdge = this._hoverItem && this._hoverItem.type === 'edge' && this._hoverItem.from === edge.from && this._hoverItem.to === edge.to;

                // Determine edge thickness based on layout style
                var thickness;
                var isMainEdge = mainPathSet && mainPathSet[edge.from] !== undefined && mainPathSet[edge.to] !== undefined;
                var isRareEdge = maxEdgeCount > 0 && edge.count < maxEdgeCount * 0.1;
                if (mainPathSet && layoutDirection !== 'freeform') {
                    // Linear layout: thick main path, thin side edges, dashed rare
                    if (isMainEdge) {
                        thickness = 3.5;
                    } else {
                        thickness = 1.2;
                    }
                } else {
                    thickness = maxEdgeCount > 0 ? 0.8 + (edge.count / maxEdgeCount) * 2.5 : 1.2;
                }

                // Determine if this edge should animate
                var animateEdge = false;
                if (animateFlow === 'always') {
                    animateEdge = true;
                } else if (animateFlow === 'hover' && hoveredNodeId) {
                    animateEdge = (edge.from === hoveredNodeId || edge.to === hoveredNodeId);
                }

                // Adjust edge color for main path in linear layouts
                var thisEdgeColor = edgeColor;
                if (mainPathSet && layoutDirection !== 'freeform') {
                    if (isMainEdge) {
                        thisEdgeColor = lightenColor(edgeColor, 0.2);
                    } else {
                        thisEdgeColor = hexToRgba(edgeColor, 0.5);
                    }
                }

                // Compute curve offset for skip edges in linear layouts
                var curveOff = 0;
                if (mainPathSet && layoutDirection !== 'freeform' && !isSelfLoop) {
                    var fromIdx = mainPathSet[edge.from];
                    var toIdx = mainPathSet[edge.to];
                    if (fromIdx !== undefined && toIdx !== undefined) {
                        var skipDist = Math.abs(toIdx - fromIdx);
                        if (skipDist > 1) {
                            // Non-adjacent main path edge — route below (positive = down in horizontal, right in vertical)
                            var skipSign = (toIdx < fromIdx) ? 1 : -1; // backwards = curve more
                            curveOff = skipSign * (40 + skipDist * 25);
                        }
                    } else {
                        // Side branch edge — small offset to avoid overlap with main line
                        curveOff = 15;
                    }
                }

                // Apply user-dragged edge offset or auto-spacing offset
                var edgeKey = edge.from + '->' + edge.to;
                var userEdgeOffset = self._draggedEdgeOffsets[edgeKey];
                var autoOff = edgeAutoOffset[ei] || 0;
                if (userEdgeOffset !== undefined) {
                    curveOff = userEdgeOffset; // user override replaces auto
                } else {
                    curveOff = curveOff + autoOff; // apply auto spacing
                }

                // Draw dashed for rare edges in linear layouts
                if (isRareEdge && mainPathSet && layoutDirection !== 'freeform') {
                    ctx.save();
                    ctx.setLineDash([4, 4]);
                }
                drawEdge(ctx, fromPos.x, fromPos.y, toPos.x, toPos.y, fromR, toR, edge.count, thisEdgeColor, thickness, isHoveredEdge, showEdgeLabels, isSelfLoop, animateEdge, this._animOffset, curveOff, arrowSize, loopSizeMultiplier);
                if (isRareEdge && mainPathSet && layoutDirection !== 'freeform') {
                    ctx.setLineDash([]);
                    ctx.restore();
                }

                // Store edge hit data with actual bezier geometry matching drawEdge
                var hitData = {
                    from: edge.from, to: edge.to,
                    count: edge.count,
                    durations: edge.durations,
                    isSelfLoop: isSelfLoop
                };
                if (isSelfLoop) {
                    // Match drawEdge self-loop geometry
                    var baseHitLoopR = Math.max(12, fromR * 0.6) * loopSizeMultiplier;
                    hitData.loopX = fromPos.x + fromR * 0.5 + baseHitLoopR * 0.3;
                    hitData.loopY = fromPos.y - fromR * 0.5 - baseHitLoopR * 0.3;
                    hitData.loopR = baseHitLoopR;
                } else {
                    // Match drawEdge bezier geometry (start/end on circle edges)
                    var edx = toPos.x - fromPos.x;
                    var edy = toPos.y - fromPos.y;
                    var edist = Math.sqrt(edx * edx + edy * edy);
                    if (edist > 0) {
                        var eux = edx / edist;
                        var euy = edy / edist;
                        hitData.sx = fromPos.x + eux * fromR;
                        hitData.sy = fromPos.y + euy * fromR;
                        hitData.ex = toPos.x - eux * toR;
                        hitData.ey = toPos.y - euy * toR;
                        var eperpX = -euy;
                        var eperpY = eux;
                        var ecurve = (curveOff !== 0) ? curveOff : Math.min(edist * 0.1, 20);
                        hitData.cpx = (hitData.sx + hitData.ex) / 2 + eperpX * ecurve;
                        hitData.cpy = (hitData.sy + hitData.ey) / 2 + eperpY * ecurve;
                    }
                }
                this._hitEdges.push(hitData);
            }

            // 14. Draw nodes
            for (var dn = 0; dn < graph.nodes.length; dn++) {
                var node = graph.nodes[dn];
                var pos = layout.positions[node.id];
                if (!pos) continue;
                var radius = computeNodeRadius(node.count, maxCount, node.id, layout.maxNodesInLevel, spacePerNode);
                var isStart = node.id === '__start__';
                var isEnd = node.id === '__end__';

                // Determine node color based on most common status
                var nColor = nodeColor;
                var hasErrors = false;
                var errorCount = 0;
                if (!isStart && !isEnd && node.statuses) {
                    var topStatus = null;
                    var topCount = 0;
                    // Check for any error statuses
                    for (var sk in node.statuses) {
                        if (node.statuses.hasOwnProperty(sk)) {
                            var ls = sk.toLowerCase();
                            if (ls === 'error' || ls === 'fail' || ls === 'failed' || ls.charAt(0) === '4' || ls.charAt(0) === '5') {
                                hasErrors = true;
                                errorCount += node.statuses[sk];
                            }
                            if (node.statuses[sk] > topCount) {
                                topCount = node.statuses[sk];
                                topStatus = sk;
                            }
                        }
                    }
                    if (topStatus) {
                        var lowerStatus = topStatus.toLowerCase();
                        if (lowerStatus === 'success' || lowerStatus === 'ok' || lowerStatus === '200') {
                            nColor = successColor;
                        } else if (lowerStatus === 'error' || lowerStatus === 'fail' || lowerStatus === 'failed' || lowerStatus.charAt(0) === '4' || lowerStatus.charAt(0) === '5') {
                            nColor = errorColor;
                        }
                    }
                }

                // Determine node shape
                var nodeShape = nodeShapeSetting;
                if (nodeShapeSetting === 'auto' && node.shapes) {
                    var topShape = null;
                    var topShapeCount = 0;
                    for (var shk in node.shapes) {
                        if (node.shapes.hasOwnProperty(shk) && node.shapes[shk] > topShapeCount) {
                            topShapeCount = node.shapes[shk];
                            topShape = shk;
                        }
                    }
                    if (topShape) {
                        nodeShape = topShape;
                    } else {
                        nodeShape = 'rectangle';
                    }
                }

                var isHoveredNode = this._hoverItem && this._hoverItem.type === 'node' && this._hoverItem.id === node.id;
                drawNode(ctx, pos.x, pos.y, radius, node.name, node.count, nColor, isStart, isEnd, isHoveredNode, showNodeCounts, nodeShape);

                // Draw error indicator dot if node has any errors
                if (hasErrors && !isStart && !isEnd) {
                    var dotX = pos.x + (nodeShape === 'rectangle' ? Math.max(50, radius * 2.5) / 2 - 4 : radius - 2);
                    var dotY = pos.y - (nodeShape === 'rectangle' ? Math.max(20, radius * 1.25) - 4 : radius - 2);
                    ctx.beginPath();
                    ctx.arc(dotX, dotY, 5, 0, 2 * Math.PI);
                    ctx.fillStyle = errorColor;
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    // Error count inside dot
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 7px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(formatCount(errorCount), dotX, dotY);
                }

                // Store hit data
                this._hitNodes.push({
                    id: node.id, name: node.name,
                    x: pos.x, y: pos.y, r: radius,
                    count: node.count,
                    statuses: node.statuses,
                    resources: node.resources,
                    shape: nodeShape
                });
            }

            ctx.restore();

            // 15. Draw zoom control buttons (bottom-left, screen coords)
            this._hitButtons = [];
            var btnSize = 30;
            var btnMargin = 8;
            var btnX = btnMargin;
            var btnBaseY = h - btnMargin - btnSize;

            // Fit to view button
            drawZoomButton(ctx, btnX, btnBaseY - 2 * (btnSize + btnMargin), btnSize, '\u2922');
            this._hitButtons.push({ x: btnX, y: btnBaseY - 2 * (btnSize + btnMargin), w: btnSize, h: btnSize, action: 'fitToView' });

            // Zoom in button
            drawZoomButton(ctx, btnX, btnBaseY - (btnSize + btnMargin), btnSize, '+');
            this._hitButtons.push({ x: btnX, y: btnBaseY - (btnSize + btnMargin), w: btnSize, h: btnSize, action: 'zoomIn' });

            // Zoom out button
            drawZoomButton(ctx, btnX, btnBaseY, btnSize, '\u2212');
            this._hitButtons.push({ x: btnX, y: btnBaseY, w: btnSize, h: btnSize, action: 'zoomOut' });

            // 16. Draw tooltip outside transform (screen coords)
            if (this._hoverItem && this._hoverItem.tooltipLines) {
                var mx = this._hoverItem.mouseX || 0;
                var my = this._hoverItem.mouseY || 0;
                drawTooltip(ctx, mx, my, this._hoverItem.tooltipLines, w, h);
            }
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            if (this._animTimer) {
                clearInterval(this._animTimer);
                this._animTimer = null;
            }
            if (this.canvas) {
                this.canvas.removeEventListener('wheel', this._onWheel);
                this.canvas.removeEventListener('mousedown', this._onMouseDown);
                this.canvas.removeEventListener('mousemove', this._onMouseMove);
                this.canvas.removeEventListener('mouseup', this._onMouseUp);
                this.canvas.removeEventListener('click', this._onClick);
            }
            SplunkVisualizationBase.prototype.destroy.apply(this, arguments);
        }
    });

});
