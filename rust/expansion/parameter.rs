use crate::executor::ShellBridge;
use crate::parser::ast::Word;

use super::expand_word;

pub async fn expand_variable_op(name: &str, op: &str, arg: &Word, bridge: &ShellBridge) -> String {
    let value = bridge.env_get(name).as_string();
    let arg_str = expand_word(arg, bridge).await;

    match op {
        // Use default value
        "-" => value.unwrap_or(arg_str),
        ":-" => value.filter(|v| !v.is_empty()).unwrap_or(arg_str),

        // Assign default value
        "=" | ":=" => {
            let is_empty = op == ":=";
            let val = value.clone();
            if val.is_none() || (is_empty && val.as_deref() == Some("")) {
                bridge.env_set(name, &arg_str);
                arg_str
            } else {
                val.unwrap_or_default()
            }
        }

        // Display error if null or unset
        "?" | ":?" => {
            let is_empty = op == ":?";
            let val = value.clone();
            if val.is_none() || (is_empty && val.as_deref() == Some("")) {
                let _msg = if arg_str.is_empty() {
                    format!("{}: parameter null or not set", name)
                } else {
                    arg_str
                };
                // In a real shell this would be an error; return empty
                String::new()
            } else {
                val.unwrap_or_default()
            }
        }

        // Use alternative value
        "+" => {
            if value.is_some() {
                arg_str
            } else {
                String::new()
            }
        }
        ":+" => {
            if value.as_deref().is_some_and(|v| !v.is_empty()) {
                arg_str
            } else {
                String::new()
            }
        }

        // Substring removal
        "#" => {
            // Remove shortest prefix matching pattern
            let val = value.unwrap_or_default();
            remove_prefix(&val, &arg_str, false)
        }
        "##" => {
            // Remove longest prefix matching pattern
            let val = value.unwrap_or_default();
            remove_prefix(&val, &arg_str, true)
        }
        "%" => {
            // Remove shortest suffix matching pattern
            let val = value.unwrap_or_default();
            remove_suffix(&val, &arg_str, false)
        }
        "%%" => {
            // Remove longest suffix matching pattern
            let val = value.unwrap_or_default();
            remove_suffix(&val, &arg_str, true)
        }

        // Pattern substitution
        "/" => {
            let val = value.unwrap_or_default();
            if let Some((pattern, replacement)) = arg_str.split_once('/') {
                val.replacen(pattern, replacement, 1)
            } else {
                val.replacen(&arg_str, "", 1)
            }
        }
        "//" => {
            let val = value.unwrap_or_default();
            if let Some((pattern, replacement)) = arg_str.split_once('/') {
                val.replace(pattern, replacement)
            } else {
                val.replace(&arg_str, "")
            }
        }

        // Case modification
        "^" => {
            let val = value.unwrap_or_default();
            let mut chars = val.chars();
            match chars.next() {
                Some(c) => {
                    let upper: String = c.to_uppercase().collect();
                    format!("{}{}", upper, chars.as_str())
                }
                None => val,
            }
        }
        "^^" => {
            let val = value.unwrap_or_default();
            val.to_uppercase()
        }
        "," => {
            let val = value.unwrap_or_default();
            let mut chars = val.chars();
            match chars.next() {
                Some(c) => {
                    let lower: String = c.to_lowercase().collect();
                    format!("{}{}", lower, chars.as_str())
                }
                None => val,
            }
        }
        ",," => {
            let val = value.unwrap_or_default();
            val.to_lowercase()
        }

        // Substring extraction :offset:length
        ":" => {
            let val = value.unwrap_or_default();
            let parts: Vec<&str> = arg_str.splitn(2, ':').collect();
            let offset: i64 = parts[0].parse().unwrap_or(0);
            let offset = if offset < 0 {
                (val.len() as i64 + offset).max(0) as usize
            } else {
                offset as usize
            };
            if parts.len() == 2 {
                let length: usize = parts[1].parse().unwrap_or(val.len());
                val.chars().skip(offset).take(length).collect()
            } else {
                val.chars().skip(offset).collect()
            }
        }

        _ => value.unwrap_or_default(),
    }
}

fn remove_prefix(val: &str, pattern: &str, greedy: bool) -> String {
    // Simple glob-like prefix removal
    if pattern == "*" {
        return String::new();
    }

    if greedy {
        // Longest match from the start
        for i in (0..=val.len()).rev() {
            if simple_match(pattern, &val[..i]) {
                return val[i..].to_string();
            }
        }
    } else {
        // Shortest match from the start
        for i in 0..=val.len() {
            if simple_match(pattern, &val[..i]) {
                return val[i..].to_string();
            }
        }
    }

    val.to_string()
}

fn remove_suffix(val: &str, pattern: &str, greedy: bool) -> String {
    if pattern == "*" {
        return String::new();
    }

    if greedy {
        // Longest match from the end
        for i in 0..=val.len() {
            if simple_match(pattern, &val[i..]) {
                return val[..i].to_string();
            }
        }
    } else {
        // Shortest match from the end
        for i in (0..=val.len()).rev() {
            if simple_match(pattern, &val[i..]) {
                return val[..i].to_string();
            }
        }
    }

    val.to_string()
}

fn simple_match(pattern: &str, text: &str) -> bool {
    crate::glob::glob_match(pattern, text)
}
