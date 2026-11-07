# Vendored animation and replay support

These files are copied unchanged from `vendor/prompt-spider-ui/` in this repository. The root vendor provenance and research documents identify the upstream source and license evidence. `LICENSE` retains the upstream MIT license and copyright. The dashboard imports the actual upstream `drawSpider`, not a recreated approximation. The dependency-free replay projector and configuration validator are also unchanged upstream copies. Keep these copies synchronized when updating the reviewed vendor source.

Dashboard integration supplies recorded status, active event count, time and motion preference to the original renderer. The renderer is a visual activity indicator; its heartbeat does not establish connectivity or completion. The adjacent status and event timeline provide those facts.
