"""Standalone capture-format producer. Reads a recorded frame; no desktop control."""
import argparse
import json
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--frame', type=Path, required=True)
    args = parser.parse_args()
    frame = json.loads(args.frame.read_text())
    print(json.dumps({'schema': 'capture.v1', 'observation': frame}))

if __name__ == '__main__':
    main()
