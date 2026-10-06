# Action policy

Independent fixture package. Import `SceneView` and `choose` from policy.py.
`SceneView.target_offset` is either None or normalized (x,y) in [-1,1],
with (0,0) at screen centre. `choose` returns a Decision dataclass.
This is a deterministic local policy, not an LLM. It never sends keyboard input.
