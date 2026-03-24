# Business Process Flow — Valid Searches

## Format A: Stats with connections

Each row is a node. Connections are defined via `connects_to` column (comma-separated node IDs).

### Basic
```spl
| makeresults count=1
| eval data="syslog:12450:1:firewall,ids;firewall:8920:2:siem;ids:4300:2:siem;siem:21000:3:ticketing;ticketing:1850:4:"
| makemv delim=";" data | mvexpand data
| rex field=data "(?<sourcetype>[^:]+):(?<count>[^:]+):(?<step>[^:]+):(?<connects_to>.*)"
| table sourcetype count step connects_to
```

**Configuration:** Label Field = `sourcetype`, Value Field = `count`

### With sparklines
```spl
index=_internal
| bin _time span=10m
| stats count sparkline(count) as sparkdata by sourcetype
| sort -count | head 8
| eval connects_to=case(
    sourcetype="splunkd", "scheduler",
    sourcetype="scheduler", "splunkd",
    1=1, "")
| table sourcetype count sparkdata connects_to
```

**Configuration:** Label Field = `sourcetype`, Value Field = `count`, Sparkline Field = `sparkdata`

### Real-world: Network traffic flow
```spl
index=network sourcetype=firewall
| stats sum(bytes) as bytes dc(dest_port) as ports sparkline(sum(bytes)) as trend by src_zone dest_zone
| eval connects_to=dest_zone
| rename src_zone as sourcetype, bytes as count
| table sourcetype count trend connects_to ports
```

### Real-world: Authentication flow
```spl
index=main sourcetype=auth action=*
| stats count sparkline(count) as trend by src user action
| eval connects_to=user
| rename src as sourcetype
| table sourcetype count trend connects_to action
```

---

## Format B: Timechart (sparklines only)

Each column after `_time` becomes a node with sparkline data. Connections are added manually in edit mode.

### Basic
```spl
index=_internal
| timechart span=10m count by sourcetype limit=6
```

### Synthetic demo data
```spl
| makeresults count=60
| streamstats count as i
| eval _time=relative_time(now(), "-"+tostring(i*10)+"m")
| eval syslog=round(random()%500+2800),
       firewall=round(random()%200+700),
       ids=round(random()%100+380),
       siem=round(random()%300+1900)
| fields _time syslog firewall ids siem
```

### Real-world: System metrics
```spl
index=os sourcetype=cpu
| timechart span=5m avg(cpu_load_percent) by host limit=8
```

### Real-world: Web traffic
```spl
index=web
| timechart span=15m count by uri_path limit=6
```

**Configuration:** Label Field and Value Field are ignored for timechart — nodes are auto-created from column names, values from the latest row.

---

## Column Reference

| Column | Required | Format | Description |
|--------|----------|--------|-------------|
| `sourcetype` (or Label Field) | Yes (A) | string | Node label/ID |
| `count` (or Value Field) | Yes (A) | number | Node value |
| `_time` | Yes (B) | timestamp | Time axis for timechart |
| `step` | No | number | Layout hint (left-to-right ordering) |
| `connects_to` | No | string | Comma-separated list of target node IDs |
| `sparkdata` (or Sparkline Field) | No | sparkline/array | Sparkline data from `sparkline()` function |
| Subtitle Field | No | string | Secondary text below the label |

---

## Tips

- **Connections in Format A**: Use `connects_to` for data-driven connections, or draw them manually in edit mode
- **Connections in Format B**: Always drawn manually in edit mode (timechart has no connection info)
- **Sparklines in Format A**: Use `sparkline(count)` or any `sparkline()` aggregation
- **Sparklines in Format B**: Automatic — each row is a data point in the sparkline
- **Mixed**: You can combine data-driven connections with manually drawn ones — both coexist
- **Real-time**: Both formats support real-time searches (`rt-1m` to `rt`)
