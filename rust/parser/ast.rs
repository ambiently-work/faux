use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AstNode {
    Command(CommandNode),
    Pipeline(PipelineNode),
    List(ListNode),
    Subshell(SubshellNode),
    BraceGroup(BraceGroupNode),
    Assignment(AssignmentNode),
    If(IfNode),
    For(ForNode),
    While(WhileNode),
    Until(UntilNode),
    Case(CaseNode),
    Select(SelectNode),
    Function(FunctionNode),
    Arithmetic(ArithmeticNode),
}

pub type Word = Vec<WordPart>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WordPart {
    Literal {
        value: String,
    },
    SingleQuoted {
        value: String,
    },
    DoubleQuoted {
        parts: Vec<WordPart>,
    },
    Variable {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        indirect: Option<bool>,
    },
    VariableExpansion {
        name: String,
        op: String,
        arg: Word,
    },
    VariableLength {
        name: String,
    },
    CommandSubstitution {
        body: Box<AstNode>,
    },
    ArithmeticExpansion {
        expression: String,
    },
    ProcessSubstitution {
        direction: String,
        body: Box<AstNode>,
    },
    Glob {
        pattern: String,
    },
    Tilde {
        user: String,
    },
    BraceExpansion {
        parts: Vec<Word>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Redirect {
    pub fd: i32,
    pub op: String,
    pub target: Word,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "heredocDelimiter"
    )]
    pub heredoc_delimiter: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "heredocBody"
    )]
    pub heredoc_body: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "heredocQuoted"
    )]
    pub heredoc_quoted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandNode {
    pub name: Word,
    pub prefix: Vec<AssignmentNode>,
    pub args: Vec<Word>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineNode {
    pub commands: Vec<AstNode>,
    pub negated: bool,
    #[serde(rename = "pipeStderr")]
    pub pipe_stderr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListNode {
    pub left: Box<AstNode>,
    pub right: Box<AstNode>,
    pub operator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubshellNode {
    pub body: Box<AstNode>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BraceGroupNode {
    pub body: Box<AstNode>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignmentNode {
    pub name: String,
    pub value: Word,
    pub append: bool,
    pub export: bool,
    pub local: bool,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IfNode {
    pub clauses: Vec<IfClause>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "elseBody")]
    pub else_body: Option<Box<AstNode>>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IfClause {
    pub condition: AstNode,
    pub body: AstNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForNode {
    pub variable: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<Word>>,
    pub body: Box<AstNode>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhileNode {
    pub condition: Box<AstNode>,
    pub body: Box<AstNode>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UntilNode {
    pub condition: Box<AstNode>,
    pub body: Box<AstNode>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseNode {
    pub word: Word,
    pub items: Vec<CaseItem>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseItem {
    pub patterns: Vec<Word>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Box<AstNode>>,
    pub terminator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectNode {
    pub variable: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<Word>>,
    pub body: Box<AstNode>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionNode {
    pub name: String,
    pub body: Box<AstNode>,
    pub redirects: Vec<Redirect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArithmeticNode {
    pub expression: String,
}
