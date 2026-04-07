use wasm_bindgen::prelude::*;

mod arithmetic;
mod braces;
mod glob;
mod glob_regex;

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
