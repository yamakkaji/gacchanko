# Scene source

Independent fixture package. `python3 observe.py --frame frame.json` writes one
JSON object to stdout. The `observation` contains `screen: {w,h}` and
`detections: [{name,center:[x,y]}]`. Pixel coordinates start at the upper left.
No models or live screen capture are used.
