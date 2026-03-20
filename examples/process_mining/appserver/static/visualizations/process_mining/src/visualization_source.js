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
            this._drilldownField = null;
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

        updateView: function(data) {
            // Fall back to last good data if needed
            if (!data) {
                if (this._lastGoodData) {
                    data = this._lastGoodData;
                } else {
                    return;
                }
            }

            // Stub: layout and rendering will be added in later tasks
        },

        reflow: function() {
            this.invalidateUpdateView();
        },

        destroy: function() {
            // Cleanup will be added in interactions task
        }
    });

});
