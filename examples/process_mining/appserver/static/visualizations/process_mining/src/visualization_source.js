/*
 * Process Mining — Splunk Custom Visualization
 *
 * Renders a process mining directed graph from raw event sequences.
 * Computes transitions, builds a Sugiyama-inspired layered layout,
 * and draws interactive nodes and edges on Canvas 2D.
 *
 * Expected SPL columns: _time, case_id, activity, status (optional), resource (optional)
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
    function buildProcessGraph(rows, colIdx, caseField, activityField, timeField, statusField, resourceField) {
        var casesMap = {};      // caseId -> array of { time, activity, status, resource, origIdx }
        var caseOrder = [];     // preserve insertion order of case IDs

        var timeIdx     = (timeField     && colIdx[timeField]     !== undefined) ? colIdx[timeField]     : -1;
        var caseIdx     = (caseField     && colIdx[caseField]     !== undefined) ? colIdx[caseField]     : -1;
        var activityIdx = (activityField && colIdx[activityField] !== undefined) ? colIdx[activityField] : -1;
        var statusIdx   = (statusField   && colIdx[statusField]   !== undefined) ? colIdx[statusField]   : -1;
        var resourceIdx = (resourceField && colIdx[resourceField] !== undefined) ? colIdx[resourceField] : -1;

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

            if (!casesMap[caseId]) {
                casesMap[caseId] = [];
                caseOrder.push(caseId);
            }
            casesMap[caseId].push({ time: parsedTime, activity: activity, status: status, resource: resource, origIdx: i });
        }

        var nodesMap = {};   // nodeId -> { id, name, count, statuses: {}, resources: {} }
        var edgesMap = {};   // "from->to" -> { from, to, count, durations: [] }
        var casesOut = [];
        var variantMap = {};

        // Helpers for nodes and edges
        function ensureNode(id, name) {
            if (!nodesMap[id]) {
                nodesMap[id] = { id: id, name: name, count: 0, statuses: {}, resources: {} };
            }
        }

        function touchNode(id, name, status, resource) {
            ensureNode(id, name);
            nodesMap[id].count++;
            if (status) {
                nodesMap[id].statuses[status] = (nodesMap[id].statuses[status] || 0) + 1;
            }
            if (resource) {
                nodesMap[id].resources[resource] = (nodesMap[id].resources[resource] || 0) + 1;
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
            touchNode(firstId, events[0].activity, events[0].status, events[0].resource);
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

                touchNode(currId, currEvent.activity, currEvent.status, currEvent.resource);

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
     *
     * @param {Array}  levelGroups - Ordered arrays of nodeIds per level (from minimizeCrossings)
     * @param {Array}  nodes       - Array of node objects with {id, ...}
     * @param {string} direction   - 'top-down' or 'left-right'
     * @param {number} canvasW     - Canvas width in pixels
     * @param {number} canvasH     - Canvas height in pixels
     * @param {number} kpiReserve  - Pixels reserved for KPI banner (top or left)
     * @returns {Object} { positions: { nodeId: {x, y} }, graphWidth, graphHeight }
     */
    function assignPositions(levelGroups, nodes, direction, canvasW, canvasH, kpiReserve) {
        var positions = {};
        var i, j;
        var levelCount = levelGroups.length;
        if (levelCount === 0) {
            return { positions: positions, graphWidth: canvasW, graphHeight: canvasH };
        }

        if (direction === 'left-right') {
            // Levels are columns (x-axis), nodes spread vertically (y-axis)
            var availableW = canvasW - kpiReserve;
            var availableH = canvasH;
            var levelSpacingX = availableW / (levelCount + 1);

            for (i = 0; i < levelGroups.length; i++) {
                var group = levelGroups[i];
                var nodeCount = group.length;
                var x = kpiReserve + levelSpacingX * (i + 1);
                var nodeSpacingY = availableH / (nodeCount + 1);

                for (j = 0; j < group.length; j++) {
                    var nid = group[j];
                    var y = nodeSpacingY * (j + 1);
                    positions[nid] = { x: x, y: y };
                }
            }

            return {
                positions: positions,
                graphWidth: canvasW,
                graphHeight: canvasH
            };

        } else {
            // top-down (default): levels are rows (y-axis), nodes spread horizontally (x-axis)
            var availableH2 = canvasH - kpiReserve;
            var availableW2 = canvasW;
            var levelSpacingY = availableH2 / (levelCount + 1);

            for (i = 0; i < levelGroups.length; i++) {
                var group2 = levelGroups[i];
                var nodeCount2 = group2.length;
                var y2 = kpiReserve + levelSpacingY * (i + 1);
                var nodeSpacingX = availableW2 / (nodeCount2 + 1);

                for (j = 0; j < group2.length; j++) {
                    var nid2 = group2[j];
                    var x2 = nodeSpacingX * (j + 1);
                    positions[nid2] = { x: x2, y: y2 };
                }
            }

            return {
                positions: positions,
                graphWidth: canvasW,
                graphHeight: canvasH
            };
        }
    }

    /**
     * Compute node radius proportional to count.
     * Maps count linearly to range [30, 60].
     * Start (__start__) and End (__end__) nodes always return 20.
     *
     * @param {number} count    - This node's count (visit frequency)
     * @param {number} maxCount - Maximum count among all activity nodes
     * @param {string} nodeId   - The node's id (to detect start/end)
     * @returns {number} Radius in pixels
     */
    function computeNodeRadius(count, maxCount, nodeId) {
        if (nodeId === '__start__' || nodeId === '__end__') {
            return 20;
        }
        if (!maxCount || maxCount <= 0) {
            return 30;
        }
        var ratio = count / maxCount;
        // Linear interpolation between 30 and 60
        return 30 + ratio * 30;
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
     * Draw a node (circle) at (x, y) with given radius.
     * Handles regular, start, end, and hovered states.
     */
    function drawNode(ctx, x, y, radius, label, count, color, isStart, isEnd, isHovered, showCount) {
        ctx.save();

        var fillColor = isHovered ? lightenColor(color, 0.3) : color;
        var borderWidth = isHovered ? 3 : 2;

        if (isStart) {
            // Dark small circle with "Start" label below
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = isHovered ? '#555' : '#333';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = borderWidth;
            ctx.stroke();

            ctx.fillStyle = '#ccc';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('Start', x, y + radius + 4);

        } else if (isEnd) {
            // Double circle (outer ring + inner filled)
            var outerR = radius + 5;
            ctx.beginPath();
            ctx.arc(x, y, outerR, 0, 2 * Math.PI);
            ctx.strokeStyle = isHovered ? lightenColor('#607d8b', 0.3) : '#607d8b';
            ctx.lineWidth = borderWidth;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = isHovered ? '#555' : '#333';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = borderWidth;
            ctx.stroke();

            ctx.fillStyle = '#ccc';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('End', x, y + outerR + 4);

        } else {
            // Regular activity node
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = borderWidth;
            ctx.stroke();

            // Count label above the activity label (bold monospace)
            var labelY = y;
            if (showCount && count !== undefined && count !== null) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 11px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                labelY = y + 6;
                ctx.fillText(String(count), x, y - 7);
            }

            // Activity label — auto-size to fit inside diameter
            var truncated = truncateText(label, 20);
            var maxW = radius * 1.6;
            var fontSize = 13;
            ctx.font = fontSize + 'px sans-serif';
            while (fontSize > 7 && ctx.measureText(truncated).width > maxW) {
                fontSize--;
                ctx.font = fontSize + 'px sans-serif';
            }
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(truncated, x, labelY);
        }

        ctx.restore();
    }

    /**
     * Draw a directed edge (with arrowhead) between two node circles.
     */
    function drawEdge(ctx, fromX, fromY, toX, toY, fromR, toR, count, color, thickness, isHovered, showLabel, isSelfLoop) {
        ctx.save();

        var strokeColor = isHovered ? lightenColor(color, 0.4) : color;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isHovered ? thickness + 1 : thickness;
        ctx.fillStyle = strokeColor;

        if (isSelfLoop) {
            // Draw a loop arc above/right of the node
            var loopR = fromR * 0.9;
            var loopX = fromX + fromR * 0.7;
            var loopY = fromY - fromR * 0.7;
            ctx.beginPath();
            ctx.arc(loopX, loopY, loopR, 0, 2 * Math.PI);
            ctx.stroke();

            // Arrowhead at the bottom of the loop
            var arrowAngle = Math.PI / 2;
            drawArrowhead(ctx, loopX, loopY + loopR, arrowAngle, 8, strokeColor);

            if (showLabel && count !== undefined) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(count), loopX, loopY - loopR - 6);
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
            var curvature = Math.min(dist * 0.2, 40);
            var cx = (sx + ex) / 2 + perpX * curvature;
            var cy = (sy + ey) / 2 + perpY * curvature;

            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.quadraticCurveTo(cx, cy, ex, ey);
            ctx.stroke();

            // Arrowhead angle at end of bezier (from control point toward end)
            var arrowDx = ex - cx;
            var arrowDy = ey - cy;
            var angle = Math.atan2(arrowDy, arrowDx);
            drawArrowhead(ctx, ex, ey, angle, 8, strokeColor);

            // Edge count label at bezier midpoint t=0.5
            if (showLabel && count !== undefined) {
                var midX = 0.25 * sx + 0.5 * cx + 0.25 * ex;
                var midY = 0.25 * sy + 0.5 * cy + 0.25 * ey;
                ctx.save();
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                ctx.lineWidth = 3;
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.strokeText(String(count), midX, midY);
                ctx.fillText(String(count), midX, midY);
                ctx.restore();
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
            String(kpis.caseCount),
            String(kpis.activityCount),
            formatDuration(kpis.medianDuration),
            formatDuration(kpis.avgDuration),
            kpis.selfLoopPct.toFixed(1) + '%',
            String(kpis.variantCount)
        ];

        var colW = w / labels.length;
        ctx.save();

        for (var i = 0; i < labels.length; i++) {
            var cx = colW * i + colW / 2;

            // Small grey label on top
            ctx.fillStyle = '#9e9e9e';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(labels[i], cx, 8);

            // Large value below
            ctx.fillStyle = kpiColor;
            ctx.font = 'bold 16px monospace';
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
                // Check if clicking a zoom button (stored in _hitButtons)
                // Otherwise start panning
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
                    if (pointInCircle(wx, wy, n.x, n.y, n.r)) {
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
                            var resStr = resArr.slice(0, 3).map(function(r) { return r.name; }).join(', ');
                            tooltipLines.push('Resources: ' + resStr);
                        }
                        found = { type: 'node', id: n.id, mouseX: mx, mouseY: my, tooltipLines: tooltipLines };
                        break;
                    }
                }

                // Check edges if no node found
                if (!found) {
                    for (var j = 0; j < self._hitEdges.length; j++) {
                        var edge = self._hitEdges[j];
                        // Need to compute the bezier control point (same logic as drawEdge)
                        if (edge.isSelfLoop) {
                            // Simple check: circle area above/right of node
                            if (pointInCircle(wx, wy, edge.fromX + edge.fromR + 15, edge.fromY - edge.fromR - 15, 20)) {
                                var eDur = edge.durations.length > 0 ? formatDuration(median(edge.durations)) : 'N/A';
                                found = { type: 'edge', from: edge.from, to: edge.to, mouseX: mx, mouseY: my,
                                    tooltipLines: [edge.from + ' \u2192 ' + edge.to, 'Count: ' + edge.count, 'Avg duration: ' + eDur] };
                                break;
                            }
                        } else {
                            // Compute bezier control point (perpendicular offset)
                            var midX = (edge.fromX + edge.toX) / 2;
                            var midY = (edge.fromY + edge.toY) / 2;
                            var dx = edge.toX - edge.fromX;
                            var dy = edge.toY - edge.fromY;
                            var len = Math.sqrt(dx * dx + dy * dy);
                            var offset = Math.min(30, len * 0.15);
                            var cpx = midX + (dy / (len || 1)) * offset;
                            var cpy = midY - (dx / (len || 1)) * offset;

                            if (pointNearBezier(wx, wy, edge.fromX, edge.fromY, cpx, cpy, edge.toX, edge.toY, 6)) {
                                var dur = edge.durations.length > 0 ? formatDuration(median(edge.durations)) : 'N/A';
                                found = { type: 'edge', from: edge.from, to: edge.to, mouseX: mx, mouseY: my,
                                    tooltipLines: [edge.from + ' \u2192 ' + edge.to, 'Count: ' + edge.count, 'Median duration: ' + dur] };
                                break;
                            }
                        }
                    }
                }

                self._hoverItem = found;
                self.canvas.style.cursor = found ? 'pointer' : (self._isPanning ? 'grabbing' : 'default');
                self.invalidateUpdateView();
            };

            this._onMouseUp = function() {
                self._isPanning = false;
            };

            this._onClick = function(e) {
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
                    if (pointInCircle(world.x, world.y, n.x, n.y, n.r)) {
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
            var layoutDirection = config[ns + 'layoutDirection'] || 'top-down';
            var nodeColor = config[ns + 'nodeColor'] || '#607d8b';
            var edgeColor = config[ns + 'edgeColor'] || '#90a4ae';
            var successColor = config[ns + 'successColor'] || '#4caf50';
            var errorColor = config[ns + 'errorColor'] || '#f44336';
            var showKPIs = (config[ns + 'showKPIs'] || 'true') === 'true';
            var kpiColor = config[ns + 'kpiColor'] || '#00bcd4';
            var showEdgeLabels = (config[ns + 'showEdgeLabels'] || 'true') === 'true';
            var showNodeCounts = (config[ns + 'showNodeCounts'] || 'true') === 'true';
            this._drilldownField = config[ns + 'drilldownField'] || 'activity';

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
            var graph = buildProcessGraph(data.rows, data.colIdx, caseField, activityField, timeField, statusField, resourceField);

            // 6. KPIs
            var kpis = computeKPIs(graph);
            var kpiReserve = showKPIs ? 60 : 0;
            this._kpiReserve = kpiReserve;
            if (showKPIs) {
                drawKPIHeader(ctx, kpis, w, kpiColor);
            }

            // 7. Layout
            var dagEdges = breakCycles(graph.nodes, graph.edges);
            var levelMap = assignLevels(graph.nodes, dagEdges, '__start__');
            var nodeIds = [];
            for (var ni = 0; ni < graph.nodes.length; ni++) {
                nodeIds.push(graph.nodes[ni].id);
            }
            var levelGroups = minimizeCrossings(levelMap, dagEdges, nodeIds);
            var layout = assignPositions(levelGroups, graph.nodes, layoutDirection, w, h - kpiReserve, kpiReserve);

            // 8. Compute max count for radius scaling
            var maxCount = 0;
            for (var mc = 0; mc < graph.nodes.length; mc++) {
                if (graph.nodes[mc].count > maxCount) maxCount = graph.nodes[mc].count;
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

            // 13. Draw edges (behind nodes)
            for (var ei = 0; ei < graph.edges.length; ei++) {
                var edge = graph.edges[ei];
                var fromPos = layout.positions[edge.from];
                var toPos = layout.positions[edge.to];
                if (!fromPos || !toPos) continue;
                var fromNode = nodeById[edge.from];
                var toNode = nodeById[edge.to];
                var fromR = computeNodeRadius(fromNode ? fromNode.count : 0, maxCount, edge.from);
                var toR = computeNodeRadius(toNode ? toNode.count : 0, maxCount, edge.to);
                var thickness = maxEdgeCount > 0 ? 1 + (edge.count / maxEdgeCount) * 5 : 2;
                var isSelfLoop = edge.from === edge.to;
                var isHoveredEdge = this._hoverItem && this._hoverItem.type === 'edge' && this._hoverItem.from === edge.from && this._hoverItem.to === edge.to;

                drawEdge(ctx, fromPos.x, fromPos.y, toPos.x, toPos.y, fromR, toR, edge.count, edgeColor, thickness, isHoveredEdge, showEdgeLabels, isSelfLoop);

                // Store edge hit data (bezier control point will be needed for hit testing later)
                this._hitEdges.push({
                    from: edge.from, to: edge.to,
                    fromX: fromPos.x, fromY: fromPos.y,
                    toX: toPos.x, toY: toPos.y,
                    fromR: fromR, toR: toR,
                    count: edge.count,
                    durations: edge.durations,
                    isSelfLoop: isSelfLoop
                });
            }

            // 14. Draw nodes
            for (var dn = 0; dn < graph.nodes.length; dn++) {
                var node = graph.nodes[dn];
                var pos = layout.positions[node.id];
                if (!pos) continue;
                var radius = computeNodeRadius(node.count, maxCount, node.id);
                var isStart = node.id === '__start__';
                var isEnd = node.id === '__end__';

                // Determine node color based on most common status
                var nColor = nodeColor;
                if (!isStart && !isEnd && node.statuses) {
                    var topStatus = null;
                    var topCount = 0;
                    for (var sk in node.statuses) {
                        if (node.statuses.hasOwnProperty(sk) && node.statuses[sk] > topCount) {
                            topCount = node.statuses[sk];
                            topStatus = sk;
                        }
                    }
                    if (topStatus) {
                        var lowerStatus = topStatus.toLowerCase();
                        if (lowerStatus === 'success' || lowerStatus === 'ok' || lowerStatus === '200') {
                            nColor = successColor;
                        } else if (lowerStatus === 'error' || lowerStatus === 'fail' || lowerStatus === 'failed' || lowerStatus.charAt(0) === '4' || lowerStatus.charAt(0) === '5') {
                            nColor = errorColor;
                        }
                        // else keep default nodeColor for unknown statuses like "pending"
                    }
                }

                var isHoveredNode = this._hoverItem && this._hoverItem.type === 'node' && this._hoverItem.id === node.id;
                drawNode(ctx, pos.x, pos.y, radius, node.name, node.count, nColor, isStart, isEnd, isHoveredNode, showNodeCounts);

                // Store hit data
                this._hitNodes.push({
                    id: node.id, name: node.name,
                    x: pos.x, y: pos.y, r: radius,
                    count: node.count,
                    statuses: node.statuses,
                    resources: node.resources
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
