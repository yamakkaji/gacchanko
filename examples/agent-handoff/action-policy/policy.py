"""Independent action-selection package, unaware of capture.v1 or JSON."""
from dataclasses import dataclass

@dataclass(frozen=True)
class SceneView:
    target_offset: tuple[float, float] | None

@dataclass(frozen=True)
class Decision:
    key: str
    duration_ms: int

def choose(view: SceneView) -> Decision:
    if view.target_offset is None:
        return Decision('noop', 0)
    x, y = view.target_offset
    if abs(x) > 0.15:
        return Decision('turn_right' if x > 0 else 'turn_left', 120)
    return Decision('forward', 200)
