use super::Executor;
use crate::parser::ast::Redirect;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedRedirect {
    pub fd: i32,
    pub op: String,
    pub target: String,
}

pub async fn resolve_redirects(
    redirects: &[Redirect],
    executor: &Executor,
) -> Vec<ResolvedRedirect> {
    let mut resolved = Vec::new();
    for r in redirects {
        let target = executor.expand_word(&r.target).await;
        resolved.push(ResolvedRedirect {
            fd: r.fd,
            op: r.op.clone(),
            target,
        });
    }
    resolved
}

pub fn apply_input_redirect(
    redirects: &[ResolvedRedirect],
    stdin: &str,
    executor: &Executor,
) -> String {
    for r in redirects {
        if r.op == "<" {
            let path = executor.resolve_path(&r.target);
            let content = executor
                .bridge
                .fs_read_file(&path)
                .as_string()
                .unwrap_or_default();
            return content;
        }
        if r.op == "<<<" {
            return format!("{}\n", r.target);
        }
        if r.op == "<<" {
            // Heredoc — body would be in target
            return r.target.clone();
        }
    }
    stdin.to_string()
}

pub fn get_output_redirects(redirects: &[ResolvedRedirect]) -> Vec<ResolvedRedirect> {
    redirects
        .iter()
        .filter(|r| {
            r.op == ">"
                || r.op == ">>"
                || r.op == "&>"
                || r.op == "&>>"
        })
        .cloned()
        .collect()
}
