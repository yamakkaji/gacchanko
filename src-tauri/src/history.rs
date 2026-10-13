use crate::{graph::*, model::PatchGraph, Result};
use git2::{Oid, Repository, Signature};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

// Reject links/reparse points on every existing component, including dangling
// links. Generated files and history must never escape the selected project.
pub fn safe(root: &Path, relative: &str) -> Result<PathBuf> {
    let rel = Path::new(relative);
    if relative.is_empty() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("A project-relative path is required".into());
    }
    let mut p = root.to_path_buf();
    for c in rel.components() {
        p.push(c);
        match fs::symlink_metadata(&p) {
            Ok(m) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if m.file_attributes() & 0x400 != 0 {
                        return Err("Reparse points are not allowed in project output paths".into());
                    }
                }
                if m.file_type().is_symlink() {
                    return Err(format!("Symbolic links are not allowed: {}", p.display()).into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(p)
}
pub fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut b = Vec::new();
    fs::File::open(path)?.take(limit + 1).read_to_end(&mut b)?;
    if b.len() as u64 > limit {
        return Err("File exceeds size limit".into());
    }
    Ok(b)
}
pub fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    fs::create_dir_all(parent)?;
    let mut f = tempfile::NamedTempFile::new_in(parent)?;
    f.write_all(bytes)?;
    f.as_file().sync_all()?;
    f.persist(path)?;
    Ok(())
}
pub struct History {
    pub root: PathBuf,
    pub directory: PathBuf,
    pub protected_files: Vec<String>,
    last_manifest: String,
}
impl History {
    pub fn new(root: &Path) -> Result<Self> {
        let root = dunce::canonicalize(root)?;
        let directory = safe(&root, ".gacchanko/history.git")?;
        if !directory.exists() {
            fs::create_dir_all(directory.parent().unwrap())?;
            Repository::init_bare(&directory)?;
        }
        Repository::open_bare(&directory)?;
        Ok(Self {
            root,
            directory,
            protected_files: vec![],
            last_manifest: String::new(),
        })
    }
    fn repo(&self) -> Result<Repository> {
        safe(&self.root, ".gacchanko/history.git")?;
        // libgit2 never invokes Git hooks, external diff/textconv or executable filters.
        Ok(Repository::open_bare(&self.directory)?)
    }
    pub fn accepted(&self, rev: &str) -> Result<Option<PatchGraph>> {
        let repo = self.repo()?;
        let Ok(commit) = repo.revparse_single(rev).and_then(|o| o.peel_to_commit()) else {
            return Ok(None);
        };
        let tree = commit.tree()?;
        let entry = tree.get_path(Path::new("graph.json"))?;
        let blob = repo.find_blob(entry.id())?;
        let g: PatchGraph = serde_json::from_slice(blob.content())?;
        validate(&g)?;
        Ok(Some(g))
    }
    pub fn files(&self) -> Result<Vec<String>> {
        fn walk(root: &Path, rel: &str, out: &mut Vec<String>) -> Result<()> {
            let p = safe(root, rel)?;
            if !p.exists() {
                return Ok(());
            }
            let m = fs::metadata(&p)?;
            if m.is_file() {
                if m.len() > 20_000_000 {
                    return Err("History files must be at most 20 MB".into());
                }
                out.push(rel.into());
                if out.len() >= 10_000 {
                    return Err("History file count limit exceeded".into());
                }
            } else if m.is_dir() {
                for e in fs::read_dir(p)? {
                    let name = e?.file_name().to_string_lossy().into_owned();
                    if name.starts_with('.')
                        || ["__pycache__", "node_modules", "venv"].contains(&name.as_str())
                    {
                        continue;
                    }
                    walk(root, &format!("{rel}/{name}"), out)?;
                }
            } else {
                return Err("History only accepts regular files and directories".into());
            }
            Ok(())
        }
        let mut out = vec![];
        for name in [
            "graph.json",
            "AGENT_BRIEF.md",
            "graph.mmd",
            "connections",
            "implementations",
            "reports",
            "components",
        ] {
            walk(&self.root, name, &mut out)?;
        }
        out.sort();
        Ok(out)
    }
    fn head_files(&self) -> Result<BTreeMap<String, Oid>> {
        let r = self.repo()?;
        let Ok(head) = r.head().and_then(|h| h.peel_to_commit()) else {
            return Ok(BTreeMap::new());
        };
        let mut files = BTreeMap::new();
        head.tree()?.walk(git2::TreeWalkMode::PreOrder, |root, e| {
            if e.kind() == Some(git2::ObjectType::Blob) {
                if let Some(name) = e.name() {
                    files.insert(format!("{root}{name}"), e.id());
                }
            }
            git2::TreeWalkResult::Ok
        })?;
        Ok(files)
    }
    pub fn code_violations(&self, unlocked: &[String]) -> Result<Vec<String>> {
        let Some(g) = self.accepted("HEAD")? else {
            return Ok(vec![]);
        };
        let scopes: Vec<String> = g
            .edges
            .iter()
            .filter(|e| protected(&e.policy) && !unlocked.contains(&format!("edge:{}", e.id)))
            .map(|e| format!("implementations/{}/", e.id))
            .chain(
                g.nodes
                    .iter()
                    .filter(|n| {
                        protected(&n.policy) && !unlocked.contains(&format!("node:{}", n.id))
                    })
                    .map(|n| format!("components/nodes/{}/implementation/", n.id)),
            )
            .collect();
        let before = self.head_files()?;
        let files = self.files()?;
        let mut ids = std::collections::BTreeSet::new();
        ids.extend(before.keys().cloned());
        ids.extend(files);
        let mut out = vec![];
        for p in ids
            .into_iter()
            .filter(|p| scopes.iter().any(|s| p.starts_with(s)))
        {
            let path = safe(&self.root, &p)?;
            let after = if path.exists() {
                Some(Oid::hash_object(
                    git2::ObjectType::Blob,
                    &read_limited(&path, 20_000_000)?,
                )?)
            } else {
                None
            };
            if before.get(&p).copied() != after {
                out.push(p);
            }
        }
        Ok(out)
    }
    pub fn checkpoint(&mut self, actor: &str, message: &str, unlocked: &[String]) -> Result<()> {
        self.protected_files = self.code_violations(unlocked)?;
        if !self.protected_files.is_empty() {
            return Ok(());
        }
        let files = self.files()?;
        let mut data = Vec::new();
        let mut manifest = String::new();
        for p in files {
            let bytes = read_limited(&safe(&self.root, &p)?, 20_000_000)?;
            manifest += &format!("{p}:{}\n", hash(&bytes));
            data.push((p, bytes));
        }
        let stamp = hash(manifest.as_bytes());
        if stamp == self.last_manifest {
            return Ok(());
        }
        let repo = self.repo()?;
        let mut index = repo.index()?;
        index.clear()?;
        for (p, bytes) in data {
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::PermissionsExt;
                if fs::metadata(self.root.join(&p))?.permissions().mode() & 0o111 != 0 {
                    0o100755
                } else {
                    0o100644
                }
            };
            #[cfg(not(unix))]
            let mode = 0o100644;
            let entry = git2::IndexEntry {
                ctime: git2::IndexTime::new(0, 0),
                mtime: git2::IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode,
                uid: 0,
                gid: 0,
                file_size: bytes.len() as u32,
                id: Oid::zero(),
                flags: 0,
                flags_extended: 0,
                path: p.into_bytes(),
            };
            index.add_frombuffer(&entry, &bytes)?;
        }
        let tree_id = index.write_tree()?;
        index.write()?;
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        if parent.as_ref().map(|p| p.tree_id()) != Some(tree_id) {
            let tree = repo.find_tree(tree_id)?;
            let sig = Signature::now(actor, "gacchanko@localhost")?;
            let parents: Vec<_> = parent.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
        }
        self.last_manifest = stamp;
        Ok(())
    }
    fn diff(&self, rev: &str) -> Result<(Vec<String>, String)> {
        let r = self.repo()?;
        let c = r.revparse_single(rev)?.peel_to_commit()?;
        let tree = c.tree()?;
        let previous = c.parent(0).ok().and_then(|p| p.tree().ok());
        let diff = r.diff_tree_to_tree(previous.as_ref(), Some(&tree), None)?;
        let files = diff
            .deltas()
            .filter_map(|d| {
                d.new_file()
                    .path()
                    .or(d.old_file().path())
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
            })
            .collect();
        let mut patch = String::new();
        diff.print(git2::DiffFormat::Patch, |_, _, line| {
            if patch.len() < 2_000_000 {
                if ['+', '-', ' '].contains(&line.origin()) {
                    patch.push(line.origin());
                }
                patch.push_str(&String::from_utf8_lossy(line.content()));
            }
            true
        })?;
        Ok((files, patch))
    }
    pub fn summary(&self) -> Result<Value> {
        let r = self.repo()?;
        let Ok(head) = r.head().and_then(|h| h.peel_to_commit()) else {
            return Ok(
                json!({"head":"","commits":[],"changes":[],"files":[],"protectedFiles":self.protected_files}),
            );
        };
        let mut walk = r.revwalk()?;
        walk.push(head.id())?;
        let mut commits = vec![];
        for id in walk.take(40) {
            let c = r.find_commit(id?)?;
            let date = chrono::DateTime::from_timestamp(c.time().seconds(), 0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_default();
            commits.push(json!({"id":c.id().to_string(),"date":date,"actor":c.author().name().unwrap_or(""),"message":c.summary().unwrap_or("")}));
        }
        let current = self.accepted("HEAD")?;
        let previous = self.accepted("HEAD^")?;
        Ok(
            json!({"head":head.id().to_string(),"commits":commits,"changes":current.as_ref().map(|g|changes(previous.as_ref(),g)).unwrap_or_default(),"files":self.diff("HEAD")?.0,"directory":self.directory,"protectedFiles":self.protected_files}),
        )
    }
    pub fn detail(&self, id: &str) -> Result<Value> {
        if id.len() != 40 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid history commit ID".into());
        }
        let g = self.accepted(id)?.ok_or("Commit not found")?;
        let previous = self.accepted(&format!("{id}^"))?;
        let (files, diff) = self.diff(id)?;
        Ok(json!({"id":id,"changes":changes(previous.as_ref(),&g),"files":files,"diff":diff}))
    }
}
