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
