# Outputs

## Updated graph command
- `--no-open` flag accepted by `trellis graph`
- When set, HTTP server starts and prints URL to stdout but does not launch browser
- All existing flags (`--port`, `--json`) continue to work unchanged

## Stdout contract (unchanged)
- Line format: `Serving DAG viewer at http://localhost:<port>`
- External tools can parse this line to discover the server URL
