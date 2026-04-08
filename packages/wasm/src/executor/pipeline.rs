use super::{Executor, ShellResult, Signal};
use crate::parser::ast::AstNode;

pub async fn execute_pipeline(
    commands: &[AstNode],
    negated: bool,
    stdin: &str,
    executor: &Executor,
) -> Result<ShellResult, Signal> {
    let mut current_stdin = stdin.to_string();
    let mut last_result = ShellResult::empty();

    for command in commands {
        last_result = executor.execute_node(command, &current_stdin).await?;
        current_stdin = last_result.stdout.clone();
    }

    if negated {
        last_result.exit_code = if last_result.exit_code == 0 { 1 } else { 0 };
    }

    Ok(last_result)
}
