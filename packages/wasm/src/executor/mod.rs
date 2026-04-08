pub mod pipeline;
pub mod redirect;

use crate::parser::ast::*;
use js_sys::{Object, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use pipeline::execute_pipeline;
use redirect::{apply_input_redirect, get_output_redirects, resolve_redirects};

use crate::expansion;

#[derive(Debug, Clone)]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl ShellResult {
    pub fn empty() -> Self {
        ShellResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: 0,
        }
    }

    pub fn to_js(&self) -> JsValue {
        let obj = Object::new();
        Reflect::set(&obj, &"stdout".into(), &self.stdout.clone().into()).unwrap();
        Reflect::set(&obj, &"stderr".into(), &self.stderr.clone().into()).unwrap();
        Reflect::set(&obj, &"exitCode".into(), &self.exit_code.into()).unwrap();
        obj.into()
    }

    pub fn from_js(val: &JsValue) -> Self {
        let stdout = Reflect::get(val, &"stdout".into())
            .unwrap_or(JsValue::from_str(""))
            .as_string()
            .unwrap_or_default();
        let stderr = Reflect::get(val, &"stderr".into())
            .unwrap_or(JsValue::from_str(""))
            .as_string()
            .unwrap_or_default();
        let exit_code = Reflect::get(val, &"exitCode".into())
            .unwrap_or(JsValue::from_f64(0.0))
            .as_f64()
            .unwrap_or(0.0) as i32;
        ShellResult {
            stdout,
            stderr,
            exit_code,
        }
    }
}

/// The bridge object passed from JS that provides callbacks for environment,
/// filesystem, and command execution.
#[wasm_bindgen]
extern "C" {
    pub type ShellBridge;

    #[wasm_bindgen(method)]
    pub fn env_get(this: &ShellBridge, name: &str) -> JsValue;

    #[wasm_bindgen(method)]
    pub fn env_set(this: &ShellBridge, name: &str, value: &str);

    #[wasm_bindgen(method)]
    pub fn env_cwd(this: &ShellBridge) -> String;

    #[wasm_bindgen(method)]
    pub fn env_export(this: &ShellBridge, name: &str);

    #[wasm_bindgen(method)]
    pub fn env_mark_readonly(this: &ShellBridge, name: &str);

    #[wasm_bindgen(method)]
    pub fn env_last_exit_code(this: &ShellBridge) -> i32;

    #[wasm_bindgen(method)]
    pub fn env_set_last_exit_code(this: &ShellBridge, code: i32);

    #[wasm_bindgen(method)]
    pub fn env_get_alias(this: &ShellBridge, name: &str) -> JsValue;

    #[wasm_bindgen(method)]
    pub fn env_set_function(this: &ShellBridge, name: &str, body: JsValue);

    #[wasm_bindgen(method)]
    pub fn env_get_function(this: &ShellBridge, name: &str) -> JsValue;

    #[wasm_bindgen(method)]
    pub fn env_get_positional_args(this: &ShellBridge) -> Vec<JsValue>;

    #[wasm_bindgen(method)]
    pub fn env_set_positional_args(this: &ShellBridge, args: Vec<JsValue>);

    #[wasm_bindgen(method)]
    pub fn env_fork(this: &ShellBridge) -> ShellBridge;

    #[wasm_bindgen(method)]
    pub fn fs_read_file(this: &ShellBridge, path: &str) -> JsValue;

    #[wasm_bindgen(method)]
    pub fn fs_write_file(this: &ShellBridge, path: &str, content: &str);

    #[wasm_bindgen(method)]
    pub fn fs_append_file(this: &ShellBridge, path: &str, content: &str);

    #[wasm_bindgen(method)]
    pub fn fs_exists(this: &ShellBridge, path: &str) -> bool;

    #[wasm_bindgen(method)]
    pub fn fs_glob(this: &ShellBridge, pattern: &str, cwd: &str) -> Vec<JsValue>;

    #[wasm_bindgen(method)]
    pub fn has_command(this: &ShellBridge, name: &str) -> bool;

    #[wasm_bindgen(method)]
    pub fn execute_command(
        this: &ShellBridge,
        name: &str,
        args: Vec<JsValue>,
        stdin: &str,
        redirects: JsValue,
    ) -> js_sys::Promise;

    #[wasm_bindgen(method)]
    pub fn parse_input(this: &ShellBridge, input: &str) -> JsValue;
}

pub struct Executor {
    pub bridge: ShellBridge,
}

impl Executor {
    pub fn new(bridge: ShellBridge) -> Self {
        Executor { bridge }
    }

    /// Create an executor that references the same bridge (for command substitution).
    /// The bridge is a JS object handle — cloning its JsValue just copies the reference.
    pub fn new_ref(bridge: &ShellBridge) -> Self {
        let js_val: &JsValue = bridge.as_ref();
        let bridge_clone: ShellBridge =
            wasm_bindgen::JsCast::unchecked_into(js_val.clone());
        Executor {
            bridge: bridge_clone,
        }
    }

    pub async fn execute(&self, node: &AstNode, stdin: &str) -> ShellResult {
        match self.execute_node(node, stdin).await {
            Ok(result) => {
                self.bridge.env_set_last_exit_code(result.exit_code);
                result
            }
            Err(Signal::Exit(code)) => ShellResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: code,
            },
            Err(Signal::Return(code)) => ShellResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: code,
            },
            Err(Signal::Break(_)) | Err(Signal::Continue(_)) => ShellResult::empty(),
        }
    }

    pub fn execute_node<'a>(
        &'a self,
        node: &'a AstNode,
        stdin: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<ShellResult, Signal>> + 'a>> {
        Box::pin(self.execute_node_inner(node, stdin))
    }

    async fn execute_node_inner(&self, node: &AstNode, stdin: &str) -> Result<ShellResult, Signal> {
        match node {
            AstNode::Command(cmd) => self.execute_command_node(cmd, stdin).await,
            AstNode::Pipeline(p) => self.execute_pipeline_node(p, stdin).await,
            AstNode::List(l) => self.execute_list_node(l, stdin).await,
            AstNode::Subshell(s) => self.execute_subshell_node(s, stdin).await,
            AstNode::BraceGroup(b) => self.execute_brace_group_node(b, stdin).await,
            AstNode::Assignment(a) => self.execute_assignment_node(a).await,
            AstNode::If(i) => self.execute_if_node(i, stdin).await,
            AstNode::For(f) => self.execute_for_node(f, stdin).await,
            AstNode::While(w) => self.execute_while_node(w, stdin).await,
            AstNode::Until(u) => self.execute_until_node(u, stdin).await,
            AstNode::Case(c) => self.execute_case_node(c, stdin).await,
            AstNode::Select(s) => self.execute_select_node(s, stdin).await,
            AstNode::Function(f) => self.execute_function_node(f).await,
            AstNode::Arithmetic(a) => self.execute_arithmetic_node(a).await,
        }
    }

    pub async fn expand_word(&self, word: &Word) -> String {
        expansion::expand_word(word, &self.bridge).await
    }

    pub fn resolve_path(&self, p: &str) -> String {
        if p.starts_with('/') {
            return p.to_string();
        }
        let cwd = self.bridge.env_cwd();
        if cwd == "/" {
            format!("/{}", p)
        } else {
            format!("{}/{}", cwd, p)
        }
    }

    fn expand_glob(&self, pattern: &str) -> Vec<String> {
        if !pattern.contains('*')
            && !pattern.contains('?')
            && !pattern.contains('[')
            && !pattern.contains('{')
        {
            return vec![pattern.to_string()];
        }
        let cwd = self.bridge.env_cwd();
        let matches: Vec<String> = self
            .bridge
            .fs_glob(pattern, &cwd)
            .into_iter()
            .filter_map(|v| v.as_string())
            .collect();
        if matches.is_empty() {
            vec![pattern.to_string()]
        } else {
            matches
        }
    }

    async fn execute_command_node(
        &self,
        node: &CommandNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        // Handle prefix assignments
        let mut saved_vars: Vec<(String, Option<String>)> = Vec::new();
        for assign in &node.prefix {
            let value = self.expand_word(&assign.value).await;
            if !node.name.is_empty() {
                let old = self.bridge.env_get(&assign.name).as_string();
                saved_vars.push((assign.name.clone(), old));
            }
            self.bridge.env_set(&assign.name, &value);
            if assign.export {
                self.bridge.env_export(&assign.name);
            }
        }

        // If no command name, just assignments
        if node.name.is_empty() {
            return Ok(ShellResult::empty());
        }

        // Expand command name
        let name = self.expand_word(&node.name).await;

        // Check for alias expansion
        let alias_val = self.bridge.env_get_alias(&name);
        if let Some(alias) = alias_val.as_string() {
            let mut aliased_cmd = alias;
            for arg in &node.args {
                let expanded = self.expand_word(arg).await;
                aliased_cmd.push(' ');
                aliased_cmd.push_str(&expanded);
            }
            let ast_val = self.bridge.parse_input(&aliased_cmd);
            let ast: AstNode = serde_wasm_bindgen::from_value(ast_val)
                .unwrap_or(AstNode::Command(CommandNode {
                    name: vec![],
                    prefix: vec![],
                    args: vec![],
                    redirects: vec![],
                }));
            return self.execute_node(&ast, stdin).await;
        }

        // Expand arguments
        let mut expanded_args: Vec<String> = Vec::new();
        for arg in &node.args {
            let expanded = self.expand_word(arg).await;
            let globbed = self.expand_glob(&expanded);
            expanded_args.extend(globbed);
        }

        // Resolve redirects
        let redirects = resolve_redirects(&node.redirects, self).await;
        let effective_stdin = apply_input_redirect(&redirects, stdin, self);
        let output_redirects = get_output_redirects(&redirects);

        // Check for function
        let func_val = self.bridge.env_get_function(&name);
        if !func_val.is_undefined() && !func_val.is_null() {
            let func_ast: AstNode = serde_wasm_bindgen::from_value(func_val)
                .unwrap_or(AstNode::Command(CommandNode {
                    name: vec![],
                    prefix: vec![],
                    args: vec![],
                    redirects: vec![],
                }));
            let old_args = self.bridge.env_get_positional_args();
            let new_args: Vec<JsValue> =
                expanded_args.iter().map(|s| JsValue::from_str(s)).collect();
            self.bridge.env_set_positional_args(new_args);
            let result = self.execute_node(&func_ast, &effective_stdin).await;
            self.bridge.env_set_positional_args(old_args);
            return result;
        }

        // Execute via bridge
        let args_js: Vec<JsValue> = expanded_args.iter().map(|s| JsValue::from_str(s)).collect();

        // Serialize output redirects for JS
        let redirects_js =
            serde_wasm_bindgen::to_value(&output_redirects).unwrap_or(JsValue::NULL);

        let promise = self
            .bridge
            .execute_command(&name, args_js, &effective_stdin, redirects_js);
        match JsFuture::from(promise).await {
            Ok(val) => {
                let mut result = ShellResult::from_js(&val);

                // Apply output redirects on the Rust side
                for redir in &output_redirects {
                    let target = self.resolve_path(&redir.target);
                    if redir.op == ">" || redir.op == ">>" {
                        if redir.fd == 1 || redir.fd == -1 {
                            if redir.op == ">" {
                                self.bridge.fs_write_file(&target, &result.stdout);
                            } else {
                                self.bridge.fs_append_file(&target, &result.stdout);
                            }
                            result.stdout = String::new();
                        }
                    } else if redir.op == "&>" || redir.op == "&>>" {
                        let combined = format!("{}{}", result.stdout, result.stderr);
                        if redir.op == "&>" {
                            self.bridge.fs_write_file(&target, &combined);
                        } else {
                            self.bridge.fs_append_file(&target, &combined);
                        }
                        result.stdout = String::new();
                    }
                }

                // Restore temp vars
                for (name, value) in saved_vars {
                    match value {
                        Some(v) => self.bridge.env_set(&name, &v),
                        None => self.bridge.env_set(&name, ""),
                    }
                }

                self.bridge.env_set_last_exit_code(result.exit_code);
                Ok(result)
            }
            Err(e) => {
                let msg = e.as_string().unwrap_or_else(|| "command failed".to_string());
                Ok(ShellResult {
                    stdout: String::new(),
                    stderr: format!("{}\n", msg),
                    exit_code: 1,
                })
            }
        }
    }

    async fn execute_pipeline_node(
        &self,
        node: &PipelineNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        execute_pipeline(&node.commands, node.negated, stdin, self).await
    }

    async fn execute_list_node(
        &self,
        node: &ListNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        let left_result = self.execute_node(&node.left, stdin).await?;

        match node.operator.as_str() {
            "&&" => {
                if left_result.exit_code == 0 {
                    self.execute_node(&node.right, stdin).await
                } else {
                    Ok(left_result)
                }
            }
            "||" => {
                if left_result.exit_code != 0 {
                    self.execute_node(&node.right, stdin).await
                } else {
                    Ok(left_result)
                }
            }
            ";" => self.execute_node(&node.right, stdin).await,
            "&" => self.execute_node(&node.right, stdin).await,
            _ => Ok(left_result),
        }
    }

    async fn execute_subshell_node(
        &self,
        node: &SubshellNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        let child_bridge = self.bridge.env_fork();
        let child_exec = Executor::new(child_bridge);
        child_exec.execute_node(&node.body, stdin).await
    }

    async fn execute_brace_group_node(
        &self,
        node: &BraceGroupNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        self.execute_node(&node.body, stdin).await
    }

    async fn execute_assignment_node(&self, node: &AssignmentNode) -> Result<ShellResult, Signal> {
        let value = self.expand_word(&node.value).await;

        if node.append {
            let existing = self
                .bridge
                .env_get(&node.name)
                .as_string()
                .unwrap_or_default();
            self.bridge.env_set(&node.name, &format!("{}{}", existing, value));
        } else {
            self.bridge.env_set(&node.name, &value);
        }

        if node.export {
            self.bridge.env_export(&node.name);
        }
        if node.readonly {
            self.bridge.env_mark_readonly(&node.name);
        }

        Ok(ShellResult::empty())
    }

    async fn execute_if_node(&self, node: &IfNode, stdin: &str) -> Result<ShellResult, Signal> {
        for clause in &node.clauses {
            let cond_result = self.execute_node(&clause.condition, stdin).await?;
            if cond_result.exit_code == 0 {
                return self.execute_node(&clause.body, stdin).await;
            }
        }

        if let Some(else_body) = &node.else_body {
            return self.execute_node(else_body, stdin).await;
        }

        Ok(ShellResult::empty())
    }

    async fn execute_for_node(&self, node: &ForNode, stdin: &str) -> Result<ShellResult, Signal> {
        let words = if let Some(word_list) = &node.words {
            let mut w = Vec::new();
            for word in word_list {
                let expanded = self.expand_word(word).await;
                let globbed = self.expand_glob(&expanded);
                w.extend(globbed);
            }
            w
        } else {
            self.bridge
                .env_get_positional_args()
                .into_iter()
                .filter_map(|v| v.as_string())
                .collect()
        };

        let mut all_stdout = String::new();
        let mut all_stderr = String::new();
        let mut last_exit = 0;

        for word in words {
            self.bridge.env_set(&node.variable, &word);
            match self.execute_node(&node.body, stdin).await {
                Ok(result) => {
                    all_stdout.push_str(&result.stdout);
                    all_stderr.push_str(&result.stderr);
                    last_exit = result.exit_code;
                }
                Err(Signal::Break(levels)) => {
                    if levels > 1 {
                        return Err(Signal::Break(levels - 1));
                    }
                    break;
                }
                Err(Signal::Continue(levels)) => {
                    if levels > 1 {
                        return Err(Signal::Continue(levels - 1));
                    }
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Ok(ShellResult {
            stdout: all_stdout,
            stderr: all_stderr,
            exit_code: last_exit,
        })
    }

    async fn execute_while_node(
        &self,
        node: &WhileNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        let mut all_stdout = String::new();
        let mut all_stderr = String::new();
        let mut last_exit = 0;
        let mut iterations = 0;
        let max_iterations = 100_000;

        while iterations < max_iterations {
            let cond_result = self.execute_node(&node.condition, stdin).await?;
            if cond_result.exit_code != 0 {
                break;
            }

            match self.execute_node(&node.body, stdin).await {
                Ok(result) => {
                    all_stdout.push_str(&result.stdout);
                    all_stderr.push_str(&result.stderr);
                    last_exit = result.exit_code;
                }
                Err(Signal::Break(levels)) => {
                    if levels > 1 {
                        return Err(Signal::Break(levels - 1));
                    }
                    break;
                }
                Err(Signal::Continue(levels)) => {
                    if levels > 1 {
                        return Err(Signal::Continue(levels - 1));
                    }
                    iterations += 1;
                    continue;
                }
                Err(e) => return Err(e),
            }

            iterations += 1;
        }

        Ok(ShellResult {
            stdout: all_stdout,
            stderr: all_stderr,
            exit_code: last_exit,
        })
    }

    async fn execute_until_node(
        &self,
        node: &UntilNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        let mut all_stdout = String::new();
        let mut all_stderr = String::new();
        let mut last_exit = 0;
        let mut iterations = 0;
        let max_iterations = 100_000;

        while iterations < max_iterations {
            let cond_result = self.execute_node(&node.condition, stdin).await?;
            if cond_result.exit_code == 0 {
                break;
            }

            match self.execute_node(&node.body, stdin).await {
                Ok(result) => {
                    all_stdout.push_str(&result.stdout);
                    all_stderr.push_str(&result.stderr);
                    last_exit = result.exit_code;
                }
                Err(Signal::Break(levels)) => {
                    if levels > 1 {
                        return Err(Signal::Break(levels - 1));
                    }
                    break;
                }
                Err(Signal::Continue(levels)) => {
                    if levels > 1 {
                        return Err(Signal::Continue(levels - 1));
                    }
                    iterations += 1;
                    continue;
                }
                Err(e) => return Err(e),
            }

            iterations += 1;
        }

        Ok(ShellResult {
            stdout: all_stdout,
            stderr: all_stderr,
            exit_code: last_exit,
        })
    }

    async fn execute_case_node(
        &self,
        node: &CaseNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        let word = self.expand_word(&node.word).await;
        let mut all_stdout = String::new();
        let mut all_stderr = String::new();
        let mut last_exit = 0;
        let mut fallthrough = false;

        for item in &node.items {
            let mut matched = fallthrough;

            if !matched {
                for pattern in &item.patterns {
                    let pat_str = self.expand_word(pattern).await;
                    if glob_pattern_match(&word, &pat_str) {
                        matched = true;
                        break;
                    }
                }
            }

            if matched {
                if let Some(body) = &item.body {
                    let result = self.execute_node(body, stdin).await?;
                    all_stdout.push_str(&result.stdout);
                    all_stderr.push_str(&result.stderr);
                    last_exit = result.exit_code;
                }

                match item.terminator.as_str() {
                    ";;" => {
                        return Ok(ShellResult {
                            stdout: all_stdout,
                            stderr: all_stderr,
                            exit_code: last_exit,
                        });
                    }
                    ";&" => {
                        fallthrough = true;
                    }
                    _ => {} // ";;&" continues checking
                }
            }
        }

        Ok(ShellResult {
            stdout: all_stdout,
            stderr: all_stderr,
            exit_code: last_exit,
        })
    }

    async fn execute_select_node(
        &self,
        node: &SelectNode,
        stdin: &str,
    ) -> Result<ShellResult, Signal> {
        let words = if let Some(word_list) = &node.words {
            let mut w = Vec::new();
            for word in word_list {
                w.push(self.expand_word(word).await);
            }
            w
        } else {
            self.bridge
                .env_get_positional_args()
                .into_iter()
                .filter_map(|v| v.as_string())
                .collect()
        };

        if words.is_empty() {
            return Ok(ShellResult::empty());
        }

        // Just select the first item
        self.bridge.env_set(&node.variable, &words[0]);
        self.execute_node(&node.body, stdin).await
    }

    async fn execute_function_node(&self, node: &FunctionNode) -> Result<ShellResult, Signal> {
        let body_js = serde_wasm_bindgen::to_value(&*node.body).unwrap_or(JsValue::NULL);
        self.bridge.env_set_function(&node.name, body_js);
        Ok(ShellResult::empty())
    }

    async fn execute_arithmetic_node(
        &self,
        node: &ArithmeticNode,
    ) -> Result<ShellResult, Signal> {
        // Resolve variables in expression
        let resolved = resolve_arith_vars(&node.expression, &self.bridge);
        let result = crate::arithmetic::evaluate(&resolved);
        Ok(ShellResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: if result == 0 { 1 } else { 0 },
        })
    }
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
            let val = bridge.env_get(&name).as_string().unwrap_or_else(|| "0".to_string());
            result.push_str(&val);
        } else if chars[i].is_ascii_alphabetic() || chars[i] == '_' {
            let mut name = String::new();
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                name.push(chars[i]);
                i += 1;
            }
            let val = bridge.env_get(&name).as_string().unwrap_or_else(|| "0".to_string());
            result.push_str(&val);
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    result
}

fn glob_pattern_match(text: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    crate::glob::glob_match(pattern, text)
}

#[derive(Debug)]
pub enum Signal {
    Exit(i32),
    Return(i32),
    Break(i32),
    Continue(i32),
}
