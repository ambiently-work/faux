use wasm_bindgen::prelude::*;

mod arithmetic;
mod braces;
mod executor;
mod expansion;
mod glob;
mod glob_regex;
pub mod parser;

// ---- Existing hot-path acceleration ----

#[wasm_bindgen]
pub fn glob_match(pattern: &str, path: &str) -> bool {
    glob::glob_match(pattern, path)
}

#[wasm_bindgen]
pub fn evaluate_arithmetic(expr: &str) -> f64 {
    arithmetic::evaluate(expr) as f64
}

#[wasm_bindgen]
pub fn expand_braces(word: &str) -> Vec<JsValue> {
    braces::expand(word)
        .into_iter()
        .map(|s| JsValue::from_str(&s))
        .collect()
}

#[wasm_bindgen]
pub fn glob_to_regex(pattern: &str) -> String {
    glob_regex::to_regex(pattern)
}

// ---- New: Full parser ----

#[wasm_bindgen]
pub fn parse(input: &str) -> JsValue {
    let ast = parser::parse(input);
    serde_wasm_bindgen::to_value(&ast).unwrap_or(JsValue::NULL)
}

// ---- New: Full executor ----

#[wasm_bindgen]
pub async fn execute(ast_js: JsValue, bridge: executor::ShellBridge, stdin: &str) -> JsValue {
    let ast: parser::ast::AstNode = match serde_wasm_bindgen::from_value(ast_js) {
        Ok(a) => a,
        Err(e) => {
            let err_msg = format!("Failed to deserialize AST: {}", e);
            let result = executor::ShellResult {
                stdout: String::new(),
                stderr: err_msg,
                exit_code: 2,
            };
            return result.to_js();
        }
    };

    let exec = executor::Executor::new(bridge);
    let result = exec.execute(&ast, stdin).await;
    result.to_js()
}
