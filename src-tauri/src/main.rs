#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use gacchanko_core::{
    history::atomic,
    model::PatchGraph,
    store::{inspect, Store},
    Result,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Session {
    store: Mutex<Store>,
    dirty: AtomicBool,
    closing: AtomicBool,
    approved: AtomicBool,
    language: Mutex<String>,
}
fn arg<'a>(a: &'a Value, key: &str) -> &'a str {
    a[key].as_str().unwrap_or("")
}
fn is_ja(app: &tauri::AppHandle) -> bool {
    *app.state::<Session>().language.lock().unwrap() != "en"
}
fn title(app: &tauri::AppHandle, ja: &str, en: &str) -> String {
    if is_ja(app) { ja } else { en }.into()
}
fn menus(app: &tauri::AppHandle) -> Result<()> {
    use tauri::menu::{Menu, PredefinedMenuItem as P, Submenu};
    let edit = Submenu::with_items(
        app,
        title(app, "編集", "Edit"),
        true,
        &[
            &P::undo(app, Some(&title(app, "取り消す", "Undo")))?,
            &P::redo(app, Some(&title(app, "やり直す", "Redo")))?,
            &P::separator(app)?,
            &P::cut(app, Some(&title(app, "切り取り", "Cut")))?,
            &P::copy(app, Some(&title(app, "コピー", "Copy")))?,
            &P::paste(app, Some(&title(app, "貼り付け", "Paste")))?,
            &P::select_all(app, Some(&title(app, "すべて選択", "Select All")))?,
        ],
    )?;
    let application = Submenu::with_items(
        app,
        "gacchanko",
        true,
        &[&P::quit(
            app,
            Some(&title(app, "がっちゃんこ を終了", "Quit gacchanko")),
        )?],
    )?;
    app.set_menu(Menu::with_items(app, &[&application, &edit])?)?;
    Ok(())
}
fn confirm_exit(app: &tauri::AppHandle) {
    let state = app.state::<Session>();
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    app.dialog()
        .message(title(
            app,
            "未保存の変更を破棄して終了しますか？",
            "Discard unsaved changes and quit?",
        ))
        .title("gacchanko")
        .buttons(MessageDialogButtons::OkCancelCustom(
            title(app, "破棄して終了", "Discard and quit"),
            title(app, "編集を続ける", "Keep editing"),
        ))
        .show(move |yes| {
            let s = handle.state::<Session>();
            s.closing.store(false, Ordering::SeqCst);
            if yes {
                s.approved.store(true, Ordering::SeqCst);
                handle.exit(0);
            }
        });
}
#[tauri::command]
async fn gacchanko_rpc(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    command: String,
    args: Value,
) -> std::result::Result<Value, String> {
    if window.label() != "main" {
        return Err("Unauthorized window".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        rpc(&app, &command, &args).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn rpc(app: &tauri::AppHandle, command: &str, args: &Value) -> Result<Value> {
    let state = app.state::<Session>();
    #[cfg(debug_assertions)]
    if let Some(output) = test_output() {
        match command {
            "testCreate" => {
                let project = output
                    .parent()
                    .ok_or("Test output needs a parent directory")?
                    .join(format!("ui-{}.gacchanko", uuid::Uuid::new_v4()));
                let graph = serde_json::from_value(args["graph"].clone())?;
                return state.store.lock().unwrap().create(&project, graph);
            }
            "testReport" => {
                let store = state.store.lock().unwrap();
                let snapshot = store.snapshot()?;
                let id = snapshot["project"]["edges"][0]["id"]
                    .as_str()
                    .ok_or("Test edge missing")?;
                let path = gacchanko_core::history::safe(
                    store.root.as_ref().unwrap(),
                    &format!("reports/{id}.json"),
                )?;
                atomic(&path,serde_json::to_string(&json!({"fingerprint":snapshot["fingerprints"][id],"status":"verified","summary":"Native UI test fixture","checks":["Fixture only"],"files":[]}))?.as_bytes())?;
                return Ok(json!(true));
            }
            "testFinish" => {
                atomic(&output, &serde_json::to_vec_pretty(args)?)?;
                state.approved.store(true, Ordering::SeqCst);
                app.exit(if args["ok"] == true { 0 } else { 1 });
                return Ok(json!(true));
            }
            _ => {}
        }
    }
    // Native dialogs run off the event thread, and never hold the store lock.
    match command {
        "dirty" => {
            state
                .dirty
                .store(args["value"].as_bool().unwrap_or(false), Ordering::SeqCst);
            return Ok(json!(true));
        }
        "setLanguage" => {
            let language = arg(args, "language");
            if !["ja", "en"].contains(&language) {
                return Err("Unsupported language".into());
            }
            *state.language.lock().unwrap() = language.into();
            menus(app)?;
            return Ok(json!(true));
        }
        "chooseNodes" => {
            let paths = app
                .dialog()
                .file()
                .set_title(title(
                    app,
                    "ノードとして追加するフォルダ",
                    "Choose folders to add as nodes",
                ))
                .blocking_pick_folders()
                .unwrap_or_default();
            return Ok(json!(paths
                .into_iter()
                .map(|p| p.into_path().map(|p| p.to_string_lossy().into_owned()))
                .collect::<std::result::Result<Vec<_>, _>>()?));
        }
        "inspect" => return inspect(arg(args, "path")),
        "copy" => {
            app.clipboard().write_text(arg(args, "text"))?;
            return Ok(json!(true));
        }
        "exportJSON" => {
            let p = app
                .dialog()
                .file()
                .set_file_name("graph-export.json")
                .blocking_save_file();
            return if let Some(p) = p {
                let p = p.into_path()?;
                atomic(&p, &serde_json::to_vec_pretty(&args["graph"])?)?;
                Ok(json!(p))
            } else {
                Ok(Value::Null)
            };
        }
        "newProject" => {
            let g: PatchGraph = serde_json::from_value(args["graph"].clone())?;
            gacchanko_core::graph::validate(&g)?;
            let name = g
                .name
                .chars()
                .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
                .collect::<String>();
            let p = app
                .dialog()
                .file()
                .set_title(title(app, "プロジェクトの保存先", "Save project"))
                .set_file_name(format!("{name}.gacchanko"))
                .blocking_save_file();
            return if let Some(p) = p {
                let v = state.store.lock().unwrap().create(&p.into_path()?, g)?;
                state.dirty.store(false, Ordering::SeqCst);
                Ok(v)
            } else {
                Ok(Value::Null)
            };
        }
        "openProject" => {
            let p = app
                .dialog()
                .file()
                .set_title(title(
                    app,
                    "プロジェクトフォルダを選択",
                    "Choose a project folder",
                ))
                .blocking_pick_folder();
            return if let Some(p) = p {
                let v = state.store.lock().unwrap().open(&p.into_path()?)?;
                state.dirty.store(false, Ordering::SeqCst);
                Ok(v)
            } else {
                Ok(Value::Null)
            };
        }
        "unlock" => {
            let approved = app
                .dialog()
                .message(title(
                    app,
                    "設計の保護を解除しますか？解除は履歴に記録されます。",
                    "Unlock this component? This change is recorded in history.",
                ))
                .title("gacchanko")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    title(app, "解除", "Unlock"),
                    title(app, "キャンセル", "Cancel"),
                ))
                .blocking_show();
            return if approved {
                state.store.lock().unwrap().unlock(
                    arg(args, "kind"),
                    arg(args, "id"),
                    arg(args, "revision"),
                )
            } else {
                Ok(Value::Null)
            };
        }
        _ => {}
    }
    let mut store = state
        .store
        .lock()
        .map_err(|_| "Project store is unavailable")?;
    match command {
        "state" => store.snapshot(),
        "poll" => store.poll(),
        "save" => {
            let g = serde_json::from_value(args["graph"].clone())?;
            let v = store.save(g, arg(args, "revision"), &[], true)?;
            state.dirty.store(false, Ordering::SeqCst);
            Ok(v)
        }
        "reload" => {
            let root = store.root.clone().ok_or("Open a project first")?;
            let v = store.open(&root)?;
            state.dirty.store(false, Ordering::SeqCst);
            Ok(v)
        }
        "adoptExternal" => {
            if state.dirty.load(Ordering::SeqCst) {
                return Err("Save or export local edits before adopting a proposal".into());
            }
            store.adopt(
                arg(args, "diskRevision"),
                &serde_json::from_value::<Vec<String>>(args["selections"].clone())?,
            )
        }
        "rejectExternal" => store.reject(arg(args, "diskRevision")),
        "historyDetail" => store
            .history
            .as_ref()
            .ok_or("Save the project first")?
            .detail(arg(args, "id")),
        "copyPrompt" => {
            let text = store.prompt(
                args["edgeID"].as_str(),
                args["nodeID"].as_str(),
                &state.language.lock().unwrap(),
            )?;
            app.clipboard().write_text(&text)?;
            Ok(json!(text))
        }
        "reveal" => {
            let root = store.root.as_ref().ok_or("Save the project first")?;
            app.opener().reveal_item_in_dir(root)?;
            Ok(json!(true))
        }
        _ => Err(format!("Unsupported command: {command}").into()),
    }
}
#[cfg(debug_assertions)]
fn test_output() -> Option<std::path::PathBuf> {
    let args: Vec<_> = std::env::args().collect();
    args.iter()
        .position(|a| a == "--ui-test")
        .and_then(|i| args.get(i + 1))
        .map(std::path::PathBuf::from)
}
fn main() {
    tauri::Builder::default()
        .manage(Session::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![gacchanko_rpc])
        .setup(|app| {
            menus(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e })?;
            #[cfg(debug_assertions)]
            if let Some(output) = test_output() {
                let project = output
                    .parent()
                    .unwrap()
                    .join(format!("ui-{}.gacchanko", uuid::Uuid::new_v4()));
                let graph=serde_json::from_value(json!({"schemaVersion":1,"name":"UI test","description":"","nodes":[],"edges":[]}))?;
                app.state::<Session>()
                    .store
                    .lock()
                    .unwrap()
                    .create(&project, graph)
                    .map_err(|e| -> Box<dyn std::error::Error> { e })?;
            }
            let dev_origin = if cfg!(debug_assertions) {
                app.config().build.dev_url.as_ref().map(|url| url.origin())
            } else {
                None
            };
            let builder =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .on_navigation(move |url| {
                        dev_origin
                            .as_ref()
                            .is_some_and(|origin| *origin == url.origin())
                            || (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                            || (["http", "https"].contains(&url.scheme())
                                && url.host_str() == Some("tauri.localhost"))
                    })
                    .on_page_load(|web, payload| {
                        #[cfg(debug_assertions)]
                        if test_output().is_some()
                            && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                        {
                            let _ = web.eval(include_str!("../../tests/ui-smoke.js"));
                        }
                        #[cfg(not(debug_assertions))]
                        let _ = (web, payload);
                    });
            #[cfg(debug_assertions)]
            let builder = if let Some(output) = test_output() {
                builder.incognito(true).title("gacchanko — automatic UI test").data_directory(output.parent().unwrap().join("webview-test-data"))
            } else {
                builder
            };
            builder.build()?;
            Ok(())
        })
        .on_webview_event(|web, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) =
                event
            {
                let scale = web.window().scale_factor().unwrap_or(1.0);
                let _ = web.emit(
                    "gacchanko://drop",
                    json!({"paths":paths,"x":position.x/scale,"y":position.y/scale}),
                );
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let s = window.state::<Session>();
                if s.dirty.load(Ordering::SeqCst) && !s.approved.load(Ordering::SeqCst) {
                    api.prevent_close();
                    confirm_exit(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to start gacchanko")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let s = app.state::<Session>();
                if s.dirty.load(Ordering::SeqCst) && !s.approved.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    confirm_exit(app);
                }
            }
        });
}
