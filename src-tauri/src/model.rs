use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateOrigin {
    #[serde(rename = "templateID")]
    pub template_id: String,
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "memberID")]
    pub member_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeAppearance {
    #[serde(rename = "color")]
    pub color: String,
    #[serde(rename = "radius")]
    pub radius: f64,
    #[serde(rename = "corners")]
    pub corners: String,
    #[serde(rename = "surface")]
    pub surface: String,
    #[serde(rename = "header")]
    pub header: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchNode {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "path")]
    pub path: String,
    #[serde(rename = "kind")]
    pub kind: String,
    #[serde(rename = "description")]
    pub description: String,
    #[serde(rename = "command")]
    pub command: String,
    #[serde(rename = "inputs")]
    pub inputs: Vec<String>,
    #[serde(rename = "outputs")]
    pub outputs: Vec<String>,
    #[serde(rename = "x")]
    pub x: f64,
    #[serde(rename = "y")]
    pub y: f64,
    #[serde(rename = "policy", default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
    #[serde(
        rename = "designInstructions",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub design_instructions: Option<String>,
    #[serde(
        rename = "derivedFrom",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub derived_from: Option<TemplateOrigin>,
    #[serde(
        rename = "appearance",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub appearance: Option<NodeAppearance>,
    #[serde(
        rename = "implementationState",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub implementation_state: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeExecution {
    #[serde(rename = "dispatch")]
    pub dispatch: String,
    #[serde(rename = "join")]
    pub join: String,
    #[serde(rename = "after")]
    pub after: Vec<String>,
    #[serde(rename = "maxConcurrency")]
    pub max_concurrency: i64,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: i64,
    #[serde(rename = "bufferSize")]
    pub buffer_size: i64,
    #[serde(rename = "overflow")]
    pub overflow: String,
    #[serde(rename = "onError")]
    pub on_error: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeAppearance {
    #[serde(rename = "style")]
    pub style: String,
    #[serde(rename = "source")]
    pub source: String,
    #[serde(rename = "target")]
    pub target: String,
    #[serde(rename = "patternColour")]
    pub pattern_colour: String,
    #[serde(rename = "pattern")]
    pub pattern: String,
    #[serde(rename = "width")]
    pub width: f64,
    #[serde(rename = "spacing")]
    pub spacing: f64,
    #[serde(rename = "size")]
    pub size: f64,
    #[serde(rename = "arrows")]
    pub arrows: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgePosition {
    #[serde(rename = "x")]
    pub x: f64,
    #[serde(rename = "y")]
    pub y: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEdge {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "source")]
    pub source: String,
    #[serde(rename = "target")]
    pub target: String,
    #[serde(rename = "sourcePort")]
    pub source_port: String,
    #[serde(rename = "targetPort")]
    pub target_port: String,
    #[serde(rename = "label")]
    pub label: String,
    #[serde(rename = "intent")]
    pub intent: String,
    #[serde(rename = "mode")]
    pub mode: String,
    #[serde(rename = "policy", default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
    #[serde(
        rename = "designInstructions",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub design_instructions: Option<String>,
    #[serde(
        rename = "derivedFrom",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub derived_from: Option<TemplateOrigin>,
    #[serde(rename = "layer", default, skip_serializing_if = "Option::is_none")]
    pub layer: Option<String>,
    #[serde(rename = "execution", default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<EdgeExecution>,
    #[serde(rename = "path", default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(
        rename = "implementationState",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub implementation_state: Option<String>,
    #[serde(
        rename = "appearance",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub appearance: Option<EdgeAppearance>,
    #[serde(
        rename = "sourcePosition",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub source_position: Option<EdgePosition>,
    #[serde(
        rename = "targetPosition",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub target_position: Option<EdgePosition>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphTemplate {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "instructions")]
    pub instructions: String,
    #[serde(rename = "nodes")]
    pub nodes: Vec<PatchNode>,
    #[serde(rename = "edges")]
    pub edges: Vec<PatchEdge>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchGraph {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "description")]
    pub description: String,
    #[serde(rename = "nodes")]
    pub nodes: Vec<PatchNode>,
    #[serde(rename = "edges")]
    pub edges: Vec<PatchEdge>,
    #[serde(rename = "templates", default, skip_serializing_if = "Option::is_none")]
    pub templates: Option<Vec<GraphTemplate>>,
}
