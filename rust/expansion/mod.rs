pub mod parameter;

use crate::executor::ShellBridge;
use crate::parser::ast::*;
use parameter::expand_variable_op;

pub async fn expand_word(word: &Word, bridge: &ShellBridge) -> String {
    let mut parts: Vec<String> = Vec::new();
    for part in word {
        parts.push(expand_part(part, bridge).await);
    }
    parts.join("")
}

fn expand_part<'a>(
    part: &'a WordPart,
    bridge: &'a ShellBridge,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = String> + 'a>> {
    Box::pin(async move { expand_part_inner(part, bridge).await })
}

async fn expand_part_inner(part: &WordPart, bridge: &ShellBridge) -> String {
    match part {
        WordPart::Literal { value } => value.clone(),

        WordPart::SingleQuoted { value } => value.clone(),

        WordPart::DoubleQuoted { parts } => {
            let mut result = Vec::new();
            for p in parts {
                result.push(expand_part(p, bridge).await);
            }
            result.join("")
        }

        WordPart::Variable { name, .. } => expand_variable(name, bridge),

        WordPart::VariableExpansion { name, op, arg } => {
            expand_variable_op(name, op, arg, bridge).await
        }

        WordPart::VariableLength { name } => {
            let val = bridge.env_get(name).as_string().unwrap_or_default();
            val.len().to_string()
        }

        WordPart::CommandSubstitution { body } => {
            let executor = crate::executor::Executor::new_ref(bridge);
            let result = executor.execute(body, "").await;
            // Remove trailing newlines like bash does
            result.stdout.trim_end_matches('\n').to_string()
        }

        WordPart::ArithmeticExpansion { expression } => {
            let resolved = resolve_arith_vars(expression, bridge);
            crate::arithmetic::evaluate(&resolved).to_string()
        }

        WordPart::ProcessSubstitution { .. } => "/dev/fd/63".to_string(),

        WordPart::Glob { pattern } => pattern.clone(),

        WordPart::Tilde { user } => {
            if user.is_empty()
                || bridge.env_get("USER").as_string().as_deref() == Some(user.as_str())
            {
                bridge
                    .env_get("HOME")
                    .as_string()
                    .unwrap_or_else(|| "/root".to_string())
            } else {
                format!("/home/{}", user)
            }
        }

        WordPart::BraceExpansion { parts } => {
            let mut results = Vec::new();
            for w in parts {
                results.push(expand_word(w, bridge).await);
            }
            results.join(" ")
        }
    }
}

fn expand_variable(name: &str, bridge: &ShellBridge) -> String {
    // Special variables
    if name == "?" {
        return bridge.env_last_exit_code().to_string();
    }

    bridge.env_get(name).as_string().unwrap_or_default()
}

fn resolve_arith_vars(expr: &str, bridge: &ShellBridge) -> String {
    let mut result = String::new();
    let chars: Vec<char> = expr.trim().chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '$' {
            i += 1;
            let mut name = String::new();
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                name.push(chars[i]);
                i += 1;
            }
            let val = bridge
                .env_get(&name)
                .as_string()
                .unwrap_or_else(|| "0".to_string());
            result.push_str(&val);
        } else if chars[i].is_ascii_alphabetic() || chars[i] == '_' {
            let mut name = String::new();
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                name.push(chars[i]);
                i += 1;
            }
            let val = bridge
                .env_get(&name)
                .as_string()
                .unwrap_or_else(|| "0".to_string());
            result.push_str(&val);
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    result
}
