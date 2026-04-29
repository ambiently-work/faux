pub mod ast;
pub mod tokenizer;

use ast::*;
use tokenizer::{Token, TokenType, Tokenizer};

pub fn parse(input: &str) -> AstNode {
    let mut parser = Parser::new(input);
    parser.parse()
}

struct Parser {
    tokenizer: Tokenizer,
    pushed_back: Option<Token>,
}

impl Parser {
    fn new(input: &str) -> Self {
        Parser {
            tokenizer: Tokenizer::new(input),
            pushed_back: None,
        }
    }

    fn parse(&mut self) -> AstNode {
        self.skip_newlines();
        if self.peek().token_type == TokenType::Eof {
            return AstNode::Command(CommandNode {
                name: vec![],
                prefix: vec![],
                args: vec![],
                redirects: vec![],
            });
        }
        let node = self.parse_compound_list();
        self.skip_newlines();
        if self.peek().token_type != TokenType::Eof {
            panic!("Unexpected token: '{}'", self.peek().value);
        }
        node
    }

    fn peek(&mut self) -> &Token {
        if self.pushed_back.is_some() {
            return self.pushed_back.as_ref().unwrap();
        }
        self.tokenizer.peek()
    }

    fn next(&mut self) -> Token {
        if let Some(t) = self.pushed_back.take() {
            return t;
        }
        self.tokenizer.next()
    }

    fn eat(&mut self, tt: TokenType) -> Token {
        let t = self.next();
        if t.token_type != tt {
            panic!(
                "Expected {:?} but got {:?} ('{}')",
                tt, t.token_type, t.value
            );
        }
        t
    }

    fn check(&mut self, types: &[TokenType]) -> bool {
        types.contains(&self.peek().token_type)
    }

    fn is_keyword(&mut self, value: &str) -> bool {
        self.peek().value == value
    }

    fn is_list_terminator(&mut self) -> bool {
        let v = self.peek().value.as_str();
        matches!(v, "then" | "else" | "elif" | "fi" | "do" | "done" | "esac")
    }

    fn skip_newlines(&mut self) {
        while self.peek().token_type == TokenType::Newline {
            self.next();
        }
    }

    fn is_redirect_op(tt: &TokenType) -> bool {
        matches!(
            tt,
            TokenType::Less
                | TokenType::Great
                | TokenType::DLess
                | TokenType::DGreat
                | TokenType::LessAnd
                | TokenType::GreatAnd
                | TokenType::LessGreat
                | TokenType::DLessDash
                | TokenType::Clobber
                | TokenType::AndGreat
                | TokenType::AndDGreat
                | TokenType::TLess
        )
    }

    fn is_compound_start(&mut self) -> bool {
        let tt = self.peek().token_type.clone();
        let v = self.peek().value.clone();
        tt == TokenType::LParen
            || tt == TokenType::LBrace
            || matches!(
                v.as_str(),
                "if" | "for" | "while" | "until" | "case" | "select"
            )
    }

    // ---- Compound list / list parsing ----

    fn parse_compound_list(&mut self) -> AstNode {
        self.skip_newlines();
        let mut node = self.parse_and_or();

        loop {
            let tt = self.peek().token_type.clone();
            if tt == TokenType::Semi || tt == TokenType::Amp {
                let op = self.next();
                self.skip_newlines();

                let peek_tt = &self.peek().token_type;
                if *peek_tt == TokenType::Eof
                    || *peek_tt == TokenType::RParen
                    || *peek_tt == TokenType::RBrace
                    || *peek_tt == TokenType::DSemi
                    || *peek_tt == TokenType::SemiAnd
                    || *peek_tt == TokenType::DSemiAnd
                    || self.is_list_terminator()
                {
                    if op.token_type == TokenType::Amp {
                        node = AstNode::List(ListNode {
                            left: Box::new(node),
                            right: Box::new(AstNode::Command(CommandNode {
                                name: vec![],
                                prefix: vec![],
                                args: vec![],
                                redirects: vec![],
                            })),
                            operator: "&".to_string(),
                        });
                    }
                    break;
                }
                let right = self.parse_and_or();
                let operator = if op.token_type == TokenType::Amp {
                    "&"
                } else {
                    ";"
                };
                node = AstNode::List(ListNode {
                    left: Box::new(node),
                    right: Box::new(right),
                    operator: operator.to_string(),
                });
            } else if tt == TokenType::Newline {
                self.next();
                self.skip_newlines();

                let peek_tt = &self.peek().token_type;
                if *peek_tt == TokenType::Eof
                    || *peek_tt == TokenType::RParen
                    || *peek_tt == TokenType::RBrace
                    || *peek_tt == TokenType::DSemi
                    || *peek_tt == TokenType::SemiAnd
                    || *peek_tt == TokenType::DSemiAnd
                    || self.is_list_terminator()
                {
                    break;
                }
                let right = self.parse_and_or();
                node = AstNode::List(ListNode {
                    left: Box::new(node),
                    right: Box::new(right),
                    operator: ";".to_string(),
                });
            } else {
                break;
            }
        }

        node
    }

    fn parse_and_or(&mut self) -> AstNode {
        let mut node = self.parse_pipeline();

        while self.check(&[TokenType::And, TokenType::Or]) {
            let op = self.next();
            self.skip_newlines();
            let right = self.parse_pipeline();
            let operator = if op.token_type == TokenType::And {
                "&&"
            } else {
                "||"
            };
            node = AstNode::List(ListNode {
                left: Box::new(node),
                right: Box::new(right),
                operator: operator.to_string(),
            });
        }

        node
    }

    fn parse_pipeline(&mut self) -> AstNode {
        let mut negated = false;
        if self.peek().token_type == TokenType::Bang {
            self.next();
            negated = true;
        }

        // Skip time keyword
        if self.is_keyword("time") {
            self.next();
        }

        let first = self.parse_command();
        let mut commands = vec![first];
        let mut pipe_stderr = false;

        while self.check(&[TokenType::Pipe, TokenType::PipeAnd]) {
            let pipe_token = self.next();
            if pipe_token.token_type == TokenType::PipeAnd {
                pipe_stderr = true;
            }
            self.skip_newlines();
            commands.push(self.parse_command());
        }

        if commands.len() == 1 && !negated {
            return commands.into_iter().next().unwrap();
        }

        AstNode::Pipeline(PipelineNode {
            commands,
            negated,
            pipe_stderr,
        })
    }

    fn parse_command(&mut self) -> AstNode {
        // function keyword
        if self.peek().value == "function" {
            return self.parse_function_keyword();
        }

        // Compound commands
        if self.is_compound_start() {
            let node = self.parse_compound_command();
            let redirects = self.parse_redirects();
            self.apply_redirects(node, redirects)
        } else {
            // Simple command (includes assignments)
            self.parse_simple_command()
        }
    }

    fn parse_function_keyword(&mut self) -> AstNode {
        self.next(); // "function"
        let name_token = self.next();
        let name = name_token.value;

        // Optional ( )
        if self.peek().token_type == TokenType::LParen {
            self.next();
            self.eat(TokenType::RParen);
        }

        self.skip_newlines();
        let body = self.parse_compound_command();
        let redirects = self.parse_redirects();

        AstNode::Function(FunctionNode {
            name,
            body: Box::new(body),
            redirects,
        })
    }

    fn parse_compound_command(&mut self) -> AstNode {
        let tt = self.peek().token_type.clone();
        let v = self.peek().value.clone();

        if tt == TokenType::LParen {
            return self.parse_subshell();
        }
        if tt == TokenType::LBrace {
            return self.parse_brace_group();
        }

        match v.as_str() {
            "if" => self.parse_if(),
            "for" => self.parse_for(),
            "while" => self.parse_while(),
            "until" => self.parse_until(),
            "case" => self.parse_case(),
            "select" => self.parse_select(),
            _ => panic!("Expected compound command, got {:?} ('{}')", tt, v),
        }
    }

    fn parse_subshell(&mut self) -> AstNode {
        self.eat(TokenType::LParen);
        let body = self.parse_compound_list();
        self.eat(TokenType::RParen);
        AstNode::Subshell(SubshellNode {
            body: Box::new(body),
            redirects: vec![],
        })
    }

    fn parse_brace_group(&mut self) -> AstNode {
        self.eat(TokenType::LBrace);
        let body = self.parse_compound_list();
        self.eat(TokenType::RBrace);
        AstNode::BraceGroup(BraceGroupNode {
            body: Box::new(body),
            redirects: vec![],
        })
    }

    fn parse_if(&mut self) -> AstNode {
        self.next(); // "if"
        let mut clauses = Vec::new();

        let condition = self.parse_compound_list();
        self.eat_keyword("then");
        let body = self.parse_compound_list();
        clauses.push(IfClause { condition, body });

        while self.is_keyword("elif") {
            self.next();
            let elif_condition = self.parse_compound_list();
            self.eat_keyword("then");
            let elif_body = self.parse_compound_list();
            clauses.push(IfClause {
                condition: elif_condition,
                body: elif_body,
            });
        }

        let else_body = if self.is_keyword("else") {
            self.next();
            Some(Box::new(self.parse_compound_list()))
        } else {
            None
        };

        self.eat_keyword("fi");

        AstNode::If(IfNode {
            clauses,
            else_body,
            redirects: vec![],
        })
    }

    fn parse_for(&mut self) -> AstNode {
        self.next(); // "for"
        let var_token = self.next();
        let variable = var_token.value;

        let mut words = None;
        self.skip_newlines();

        if self.is_keyword("in") {
            self.next();
            let mut w = Vec::new();
            while !self.is_keyword("do")
                && !self.check(&[TokenType::Semi, TokenType::Newline, TokenType::Eof])
            {
                w.push(self.parse_word());
            }
            words = Some(w);
            if self.check(&[TokenType::Semi, TokenType::Newline]) {
                self.next();
            }
        } else if self.check(&[TokenType::Semi, TokenType::Newline]) {
            self.next();
        }

        self.skip_newlines();
        let body = self.parse_do_group();

        AstNode::For(ForNode {
            variable,
            words,
            body: Box::new(body),
            redirects: vec![],
        })
    }

    fn parse_while(&mut self) -> AstNode {
        self.next(); // "while"
        let condition = self.parse_compound_list();
        let body = self.parse_do_group();
        AstNode::While(WhileNode {
            condition: Box::new(condition),
            body: Box::new(body),
            redirects: vec![],
        })
    }

    fn parse_until(&mut self) -> AstNode {
        self.next(); // "until"
        let condition = self.parse_compound_list();
        let body = self.parse_do_group();
        AstNode::Until(UntilNode {
            condition: Box::new(condition),
            body: Box::new(body),
            redirects: vec![],
        })
    }

    fn parse_do_group(&mut self) -> AstNode {
        self.eat_keyword("do");
        let body = self.parse_compound_list();
        self.eat_keyword("done");
        body
    }

    fn parse_case(&mut self) -> AstNode {
        self.next(); // "case"
        let word = self.parse_word();
        self.skip_newlines();
        self.eat_keyword("in");
        self.skip_newlines();

        let mut items = Vec::new();

        while !self.is_keyword("esac") {
            // Optional leading (
            if self.peek().token_type == TokenType::LParen {
                self.next();
            }

            // Patterns
            let mut patterns = vec![self.parse_word()];
            while self.peek().token_type == TokenType::Pipe {
                self.next();
                patterns.push(self.parse_word());
            }

            self.eat(TokenType::RParen);
            self.skip_newlines();

            // Body (may be empty)
            let mut body = None;
            let mut terminator = ";;".to_string();

            if !self.check(&[TokenType::DSemi, TokenType::SemiAnd, TokenType::DSemiAnd])
                && !self.is_keyword("esac")
            {
                body = Some(Box::new(self.parse_compound_list()));
            }

            if self.check(&[TokenType::DSemi, TokenType::SemiAnd, TokenType::DSemiAnd]) {
                let t = self.next();
                terminator = match t.token_type {
                    TokenType::DSemi => ";;".to_string(),
                    TokenType::SemiAnd => ";&".to_string(),
                    TokenType::DSemiAnd => ";;&".to_string(),
                    _ => ";;".to_string(),
                };
            }

            self.skip_newlines();
            items.push(CaseItem {
                patterns,
                body,
                terminator,
            });
        }

        self.eat_keyword("esac");

        AstNode::Case(CaseNode {
            word,
            items,
            redirects: vec![],
        })
    }

    fn parse_select(&mut self) -> AstNode {
        self.next(); // "select"
        let var_token = self.next();
        let variable = var_token.value;

        let mut words = None;
        self.skip_newlines();

        if self.is_keyword("in") {
            self.next();
            let mut w = Vec::new();
            while !self.is_keyword("do")
                && !self.check(&[TokenType::Semi, TokenType::Newline, TokenType::Eof])
            {
                w.push(self.parse_word());
            }
            words = Some(w);
            if self.check(&[TokenType::Semi, TokenType::Newline]) {
                self.next();
            }
        } else if self.check(&[TokenType::Semi, TokenType::Newline]) {
            self.next();
        }

        self.skip_newlines();
        let body = self.parse_do_group();

        AstNode::Select(SelectNode {
            variable,
            words,
            body: Box::new(body),
            redirects: vec![],
        })
    }

    fn parse_simple_command(&mut self) -> AstNode {
        let mut prefix: Vec<AssignmentNode> = Vec::new();
        let mut redirects: Vec<Redirect> = Vec::new();
        let mut args: Vec<Word> = Vec::new();
        let mut name: Option<Word> = None;

        // Parse prefix assignments and redirects
        loop {
            if self.peek().token_type == TokenType::AssignmentWord {
                prefix.push(self.parse_assignment());
                continue;
            }

            if let Some(r) = self.try_parse_redirect() {
                redirects.push(r);
                continue;
            }

            break;
        }

        // Parse command name
        if is_word_token(&self.peek().token_type) {
            let name_word = self.parse_word();

            // Check for function definition: name () compound_command
            if self.peek().token_type == TokenType::LParen {
                self.next(); // (
                self.eat(TokenType::RParen); // )
                self.skip_newlines();
                let body = self.parse_compound_command();
                let func_redirects = self.parse_redirects();
                return AstNode::Function(FunctionNode {
                    name: word_to_string(&name_word),
                    body: Box::new(body),
                    redirects: func_redirects,
                });
            }

            name = Some(name_word);

            // Parse remaining args and redirects
            loop {
                if let Some(r) = self.try_parse_redirect() {
                    redirects.push(r);
                    continue;
                }

                if self.peek().token_type == TokenType::Word
                    || self.peek().token_type == TokenType::AssignmentWord
                {
                    args.push(self.parse_word());
                    continue;
                }

                break;
            }
        }

        // Only assignments, no command
        if name.is_none() && !prefix.is_empty() && redirects.is_empty() {
            if prefix.len() == 1 {
                return AstNode::Assignment(prefix.into_iter().next().unwrap());
            }
            let mut result = AstNode::Assignment(prefix.remove(0));
            for a in prefix {
                result = AstNode::List(ListNode {
                    left: Box::new(result),
                    right: Box::new(AstNode::Assignment(a)),
                    operator: ";".to_string(),
                });
            }
            return result;
        }

        if name.is_none() && prefix.is_empty() && redirects.is_empty() {
            let tt = format!("{:?}", self.peek().token_type);
            let val = self.peek().value.clone();
            panic!("Expected command, got {} ('{}')", tt, val);
        }

        AstNode::Command(CommandNode {
            name: name.unwrap_or_default(),
            prefix,
            args,
            redirects,
        })
    }

    fn parse_assignment(&mut self) -> AssignmentNode {
        let token = self.eat(TokenType::AssignmentWord);
        let value = token.value;

        let eq_idx = value.find('=').unwrap();
        let append = eq_idx > 0 && value.as_bytes()[eq_idx - 1] == b'+';

        let name = if append {
            value[..eq_idx - 1].to_string()
        } else {
            value[..eq_idx].to_string()
        };

        let raw_value = &value[eq_idx + 1..];
        let word_value = parse_word_string(raw_value);

        AssignmentNode {
            name,
            value: word_value,
            append,
            export: false,
            local: false,
            readonly: false,
        }
    }

    fn try_parse_redirect(&mut self) -> Option<Redirect> {
        let tt = self.peek().token_type.clone();

        // Direct redirect operator
        if Self::is_redirect_op(&tt) {
            return Some(self.parse_redirect(-1));
        }

        // Check for fd-number prefix
        if tt == TokenType::Word {
            let val = self.peek().value.clone();
            if val.chars().all(|c| c.is_ascii_digit()) {
                let saved = self.next();
                if Self::is_redirect_op(&self.peek().token_type) {
                    let fd: i32 = saved.value.parse().unwrap_or(0);
                    return Some(self.parse_redirect(fd));
                }
                // Not a redirect — push back
                self.pushed_back = Some(saved);
                return None;
            }
        }

        None
    }

    fn parse_redirect(&mut self, mut fd: i32) -> Redirect {
        let op_token = self.next();
        let op = map_redirect_op(&op_token.token_type);

        // Determine default fd
        if fd == -1 {
            fd = match op_token.token_type {
                TokenType::Less
                | TokenType::DLess
                | TokenType::DLessDash
                | TokenType::LessAnd
                | TokenType::LessGreat
                | TokenType::TLess => 0,
                _ => 1,
            };
        }

        // For &> and &>>, fd is special
        if op_token.token_type == TokenType::AndGreat || op_token.token_type == TokenType::AndDGreat
        {
            fd = 1;
        }

        // Handle heredoc
        if op_token.token_type == TokenType::DLess || op_token.token_type == TokenType::DLessDash {
            let delim_word = self.parse_word();
            let delim_str = word_to_string(&delim_word);

            return Redirect {
                fd,
                op: "<<".to_string(),
                target: delim_word,
                heredoc_delimiter: Some(delim_str),
                heredoc_body: None,
                heredoc_quoted: Some(false),
            };
        }

        let target = self.parse_word();

        Redirect {
            fd,
            op,
            target,
            heredoc_delimiter: None,
            heredoc_body: None,
            heredoc_quoted: None,
        }
    }

    fn parse_redirects(&mut self) -> Vec<Redirect> {
        let mut redirects = Vec::new();
        while let Some(r) = self.try_parse_redirect() {
            redirects.push(r);
        }
        redirects
    }

    fn apply_redirects(&self, mut node: AstNode, redirects: Vec<Redirect>) -> AstNode {
        if redirects.is_empty() {
            return node;
        }
        match &mut node {
            AstNode::Subshell(n) => n.redirects.extend(redirects),
            AstNode::BraceGroup(n) => n.redirects.extend(redirects),
            AstNode::If(n) => n.redirects.extend(redirects),
            AstNode::For(n) => n.redirects.extend(redirects),
            AstNode::While(n) => n.redirects.extend(redirects),
            AstNode::Until(n) => n.redirects.extend(redirects),
            AstNode::Case(n) => n.redirects.extend(redirects),
            AstNode::Select(n) => n.redirects.extend(redirects),
            AstNode::Function(n) => n.redirects.extend(redirects),
            AstNode::Command(n) => n.redirects.extend(redirects),
            _ => {}
        }
        node
    }

    // ---- Word parsing ----

    fn parse_word(&mut self) -> Word {
        let t = self.next();
        if !is_word_token(&t.token_type) {
            panic!("Expected word, got {:?} ('{}')", t.token_type, t.value);
        }
        parse_word_string(&t.value)
    }

    fn eat_keyword(&mut self, keyword: &str) {
        let t = self.next();
        if t.value != keyword {
            panic!("Expected '{}' but got '{}'", keyword, t.value);
        }
    }
}

// ---- Word string parsing (standalone, used by both Parser and recursively) ----

fn parse_word_string(input: &str) -> Word {
    let chars: Vec<char> = input.chars().collect();
    let mut parts: Vec<WordPart> = Vec::new();
    let mut i = 0;
    let mut literal = String::new();

    let flush = |parts: &mut Vec<WordPart>, literal: &mut String| {
        if !literal.is_empty() {
            parts.push(WordPart::Literal {
                value: literal.clone(),
            });
            literal.clear();
        }
    };

    while i < chars.len() {
        let c = chars[i];

        if c == '\\' {
            i += 1;
            if i < chars.len() {
                literal.push(chars[i]);
                i += 1;
            }
            continue;
        }

        if c == '\'' {
            flush(&mut parts, &mut literal);
            i += 1;
            let mut value = String::new();
            while i < chars.len() && chars[i] != '\'' {
                value.push(chars[i]);
                i += 1;
            }
            i += 1; // closing '
            parts.push(WordPart::SingleQuoted { value });
            continue;
        }

        if c == '"' {
            flush(&mut parts, &mut literal);
            i += 1;
            let (dq_parts, end) = parse_double_quoted_parts(&chars, i);
            parts.push(WordPart::DoubleQuoted { parts: dq_parts });
            i = end;
            continue;
        }

        if c == '$' {
            flush(&mut parts, &mut literal);
            let (part, end) = parse_dollar_expansion(&chars, i);
            parts.push(part);
            i = end;
            continue;
        }

        if c == '`' {
            flush(&mut parts, &mut literal);
            i += 1;
            let mut cmd_str = String::new();
            while i < chars.len() && chars[i] != '`' {
                if chars[i] == '\\' {
                    i += 1;
                    if i < chars.len() {
                        cmd_str.push(chars[i]);
                        i += 1;
                    }
                    continue;
                }
                cmd_str.push(chars[i]);
                i += 1;
            }
            i += 1; // closing `
            let body = parse(&cmd_str);
            parts.push(WordPart::CommandSubstitution {
                body: Box::new(body),
            });
            continue;
        }

        if c == '~' && parts.is_empty() && literal.is_empty() {
            i += 1;
            let mut user = String::new();
            while i < chars.len() && is_name_char_static(chars[i]) {
                user.push(chars[i]);
                i += 1;
            }
            parts.push(WordPart::Tilde { user });
            continue;
        }

        if c == '*' || c == '?' || c == '[' {
            flush(&mut parts, &mut literal);
            let mut pattern = String::new();
            if c == '[' {
                pattern.push(chars[i]);
                i += 1;
                while i < chars.len() && chars[i] != ']' {
                    pattern.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    pattern.push(chars[i]);
                    i += 1;
                }
            } else {
                pattern.push(chars[i]);
                i += 1;
            }
            parts.push(WordPart::Glob { pattern });
            continue;
        }

        if c == '{' && i + 1 < chars.len() {
            if let Some((part, end)) = try_parse_brace_expansion(&chars, i) {
                flush(&mut parts, &mut literal);
                parts.push(part);
                i = end;
                continue;
            }
        }

        if c == '<' && i + 1 < chars.len() && chars[i + 1] == '(' {
            flush(&mut parts, &mut literal);
            let (part, end) = parse_process_substitution(&chars, i, "in");
            parts.push(part);
            i = end;
            continue;
        }

        if c == '>' && i + 1 < chars.len() && chars[i + 1] == '(' {
            flush(&mut parts, &mut literal);
            let (part, end) = parse_process_substitution(&chars, i, "out");
            parts.push(part);
            i = end;
            continue;
        }

        literal.push(c);
        i += 1;
    }

    flush(&mut parts, &mut literal);
    parts
}

fn parse_double_quoted_parts(chars: &[char], start: usize) -> (Vec<WordPart>, usize) {
    let mut parts: Vec<WordPart> = Vec::new();
    let mut i = start;
    let mut literal = String::new();

    let flush = |parts: &mut Vec<WordPart>, literal: &mut String| {
        if !literal.is_empty() {
            parts.push(WordPart::Literal {
                value: literal.clone(),
            });
            literal.clear();
        }
    };

    while i < chars.len() && chars[i] != '"' {
        let c = chars[i];

        if c == '\\' {
            i += 1;
            if i < chars.len() {
                let next = chars[i];
                if next == '$' || next == '`' || next == '"' || next == '\\' {
                    literal.push(next);
                    i += 1;
                } else {
                    literal.push('\\');
                    literal.push(next);
                    i += 1;
                }
            }
            continue;
        }

        if c == '$' {
            flush(&mut parts, &mut literal);
            let (part, end) = parse_dollar_expansion(chars, i);
            parts.push(part);
            i = end;
            continue;
        }

        if c == '`' {
            flush(&mut parts, &mut literal);
            i += 1;
            let mut cmd_str = String::new();
            while i < chars.len() && chars[i] != '`' {
                if chars[i] == '\\' {
                    i += 1;
                    if i < chars.len() {
                        cmd_str.push(chars[i]);
                        i += 1;
                    }
                    continue;
                }
                cmd_str.push(chars[i]);
                i += 1;
            }
            i += 1; // closing `
            let body = parse(&cmd_str);
            parts.push(WordPart::CommandSubstitution {
                body: Box::new(body),
            });
            continue;
        }

        literal.push(c);
        i += 1;
    }

    flush(&mut parts, &mut literal);

    if i < chars.len() && chars[i] == '"' {
        i += 1;
    }

    (parts, i)
}

fn parse_dollar_expansion(chars: &[char], start: usize) -> (WordPart, usize) {
    let mut i = start + 1; // skip $

    if i >= chars.len() {
        return (
            WordPart::Literal {
                value: "$".to_string(),
            },
            i,
        );
    }

    let c = chars[i];

    // $(( ... )) — arithmetic expansion
    if c == '(' && i + 1 < chars.len() && chars[i + 1] == '(' {
        i += 2;
        let mut depth = 1;
        let mut expr = String::new();
        while i < chars.len() && depth > 0 {
            if chars[i] == '(' && i + 1 < chars.len() && chars[i + 1] == '(' {
                depth += 1;
                expr.push(chars[i]);
                expr.push(chars[i + 1]);
                i += 2;
            } else if chars[i] == ')' && i + 1 < chars.len() && chars[i + 1] == ')' {
                depth -= 1;
                if depth > 0 {
                    expr.push(chars[i]);
                    expr.push(chars[i + 1]);
                }
                i += 2;
            } else {
                expr.push(chars[i]);
                i += 1;
            }
        }
        return (WordPart::ArithmeticExpansion { expression: expr }, i);
    }

    // $( ... ) — command substitution
    if c == '(' {
        i += 1;
        let mut depth = 1;
        let mut cmd_str = String::new();
        while i < chars.len() && depth > 0 {
            if chars[i] == '(' {
                depth += 1;
            }
            if chars[i] == ')' {
                depth -= 1;
            }
            if depth > 0 {
                if chars[i] == '\'' {
                    cmd_str.push(chars[i]);
                    i += 1;
                    while i < chars.len() && chars[i] != '\'' {
                        cmd_str.push(chars[i]);
                        i += 1;
                    }
                    if i < chars.len() {
                        cmd_str.push(chars[i]);
                        i += 1;
                    }
                } else if chars[i] == '"' {
                    cmd_str.push(chars[i]);
                    i += 1;
                    while i < chars.len() && chars[i] != '"' {
                        if chars[i] == '\\' {
                            cmd_str.push(chars[i]);
                            i += 1;
                            if i < chars.len() {
                                cmd_str.push(chars[i]);
                                i += 1;
                            }
                            continue;
                        }
                        cmd_str.push(chars[i]);
                        i += 1;
                    }
                    if i < chars.len() {
                        cmd_str.push(chars[i]);
                        i += 1;
                    }
                } else {
                    cmd_str.push(chars[i]);
                    i += 1;
                }
            } else {
                i += 1; // consume closing )
            }
        }
        let body = parse(&cmd_str);
        return (
            WordPart::CommandSubstitution {
                body: Box::new(body),
            },
            i,
        );
    }

    // ${ ... } — variable expansion
    if c == '{' {
        i += 1;

        // ${# — length
        if i < chars.len() && chars[i] == '#' {
            let after_hash = i + 1;
            if after_hash < chars.len() && chars[after_hash] != '}' {
                i += 1; // skip #
                let mut name = String::new();
                while i < chars.len() && chars[i] != '}' {
                    name.push(chars[i]);
                    i += 1;
                }
                if i < chars.len() {
                    i += 1;
                } // }
                return (WordPart::VariableLength { name }, i);
            }
        }

        // ${! — indirect
        let mut indirect = false;
        if i < chars.len() && chars[i] == '!' {
            indirect = true;
            i += 1;
        }

        // Read name
        let mut name = String::new();
        while i < chars.len()
            && !matches!(
                chars[i],
                '}' | ':' | '/' | '%' | '#' | '-' | '+' | '=' | '?' | '[' | '^' | ','
            )
        {
            name.push(chars[i]);
            i += 1;
        }

        if i < chars.len() && chars[i] == '}' {
            i += 1;
            return (
                WordPart::Variable {
                    name,
                    indirect: if indirect { Some(true) } else { None },
                },
                i,
            );
        }

        // Expansion operator
        let mut op = String::new();
        if i < chars.len() {
            if chars[i] == ':' {
                op.push(chars[i]);
                i += 1;
                if i < chars.len() && matches!(chars[i], '-' | '+' | '=' | '?') {
                    op.push(chars[i]);
                    i += 1;
                }
            } else if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
                op = "//".to_string();
                i += 2;
            } else if chars[i] == '%' && i + 1 < chars.len() && chars[i + 1] == '%' {
                op = "%%".to_string();
                i += 2;
            } else if chars[i] == '#' && i + 1 < chars.len() && chars[i + 1] == '#' {
                op = "##".to_string();
                i += 2;
            } else if chars[i] == '^' && i + 1 < chars.len() && chars[i + 1] == '^' {
                op = "^^".to_string();
                i += 2;
            } else if chars[i] == ',' && i + 1 < chars.len() && chars[i + 1] == ',' {
                op = ",,".to_string();
                i += 2;
            } else {
                op.push(chars[i]);
                i += 1;
            }
        }

        // Read argument (the rest until })
        let mut arg_str = String::new();
        let mut brace_depth = 1;
        while i < chars.len() && brace_depth > 0 {
            if chars[i] == '{' {
                brace_depth += 1;
            }
            if chars[i] == '}' {
                brace_depth -= 1;
                if brace_depth == 0 {
                    i += 1;
                    break;
                }
            }
            arg_str.push(chars[i]);
            i += 1;
        }

        let arg = parse_word_string(&arg_str);

        return (WordPart::VariableExpansion { name, op, arg }, i);
    }

    // $VAR — simple variable
    if is_special_param_char(c) {
        i += 1;
        return (
            WordPart::Variable {
                name: c.to_string(),
                indirect: None,
            },
            i,
        );
    }

    // $1-$9 — positional parameters (single digit only without braces)
    if c.is_ascii_digit() {
        i += 1;
        return (
            WordPart::Variable {
                name: c.to_string(),
                indirect: None,
            },
            i,
        );
    }

    if is_name_start_char(c) {
        let mut name = String::new();
        while i < chars.len() && is_name_char_static(chars[i]) {
            name.push(chars[i]);
            i += 1;
        }
        return (
            WordPart::Variable {
                name,
                indirect: None,
            },
            i,
        );
    }

    // Lone $ — literal
    (
        WordPart::Literal {
            value: "$".to_string(),
        },
        i,
    )
}

fn parse_process_substitution(chars: &[char], start: usize, direction: &str) -> (WordPart, usize) {
    let mut i = start + 2; // skip <( or >(
    let mut depth = 1;
    let mut cmd_str = String::new();
    while i < chars.len() && depth > 0 {
        if chars[i] == '(' {
            depth += 1;
        }
        if chars[i] == ')' {
            depth -= 1;
            if depth == 0 {
                i += 1;
                break;
            }
        }
        cmd_str.push(chars[i]);
        i += 1;
    }
    let body = parse(&cmd_str);
    (
        WordPart::ProcessSubstitution {
            direction: direction.to_string(),
            body: Box::new(body),
        },
        i,
    )
}

fn try_parse_brace_expansion(chars: &[char], start: usize) -> Option<(WordPart, usize)> {
    let mut i = start + 1;
    let mut depth = 1;
    let mut has_comma = false;
    let mut has_dot_dot = false;

    let scan_start = i;
    while i < chars.len() && depth > 0 {
        if chars[i] == '{' {
            depth += 1;
        }
        if chars[i] == '}' {
            depth -= 1;
            if depth == 0 {
                break;
            }
        }
        if depth == 1 && chars[i] == ',' {
            has_comma = true;
        }
        if depth == 1 && chars[i] == '.' && i + 1 < chars.len() && chars[i + 1] == '.' {
            has_dot_dot = true;
        }
        i += 1;
    }

    if depth != 0 {
        return None;
    }
    if !has_comma && !has_dot_dot {
        return None;
    }

    let content: String = chars[scan_start..i].iter().collect();
    i += 1; // skip closing }

    if has_comma {
        // Split by commas at depth 0
        let mut segments: Vec<String> = Vec::new();
        let mut seg = String::new();
        let mut d = 0;
        for ch in content.chars() {
            if ch == '{' {
                d += 1;
            }
            if ch == '}' {
                d -= 1;
            }
            if d == 0 && ch == ',' {
                segments.push(seg.clone());
                seg.clear();
            } else {
                seg.push(ch);
            }
        }
        segments.push(seg);

        let brace_parts: Vec<Word> = segments.iter().map(|s| parse_word_string(s)).collect();
        return Some((WordPart::BraceExpansion { parts: brace_parts }, i));
    }

    // Range expansion — represent as literal
    Some((
        WordPart::Literal {
            value: format!("{{{}}}", content),
        },
        i,
    ))
}

fn word_to_string(word: &Word) -> String {
    word.iter()
        .map(|p| match p {
            WordPart::Literal { value } => value.clone(),
            WordPart::SingleQuoted { value } => value.clone(),
            WordPart::DoubleQuoted { parts } => word_to_string(parts),
            WordPart::Variable { name, .. } => format!("${}", name),
            WordPart::Tilde { user } => format!("~{}", user),
            WordPart::Glob { pattern } => pattern.clone(),
            _ => String::new(),
        })
        .collect()
}

fn map_redirect_op(tt: &TokenType) -> String {
    match tt {
        TokenType::Less => "<".to_string(),
        TokenType::Great => ">".to_string(),
        TokenType::DLess => "<<".to_string(),
        TokenType::DGreat => ">>".to_string(),
        TokenType::LessAnd => "<&".to_string(),
        TokenType::GreatAnd => ">&".to_string(),
        TokenType::LessGreat => "<>".to_string(),
        TokenType::DLessDash => "<<".to_string(),
        TokenType::Clobber => ">".to_string(),
        TokenType::AndGreat => "&>".to_string(),
        TokenType::AndDGreat => "&>>".to_string(),
        TokenType::TLess => "<<<".to_string(),
        _ => panic!("Unknown redirect operator: {:?}", tt),
    }
}

fn is_word_token(tt: &TokenType) -> bool {
    matches!(
        tt,
        TokenType::Word
            | TokenType::AssignmentWord
            | TokenType::Bang
            | TokenType::Time
            | TokenType::If
            | TokenType::Then
            | TokenType::Else
            | TokenType::Elif
            | TokenType::Fi
            | TokenType::For
            | TokenType::While
            | TokenType::Until
            | TokenType::Do
            | TokenType::Done
            | TokenType::Case
            | TokenType::Esac
            | TokenType::In
            | TokenType::Select
            | TokenType::Function
            | TokenType::Coproc
    )
}

fn is_name_start_char(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

fn is_name_char_static(c: char) -> bool {
    is_name_start_char(c) || c.is_ascii_digit()
}

fn is_special_param_char(c: char) -> bool {
    matches!(c, '@' | '*' | '#' | '?' | '-' | '$' | '!' | '0')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_command() {
        let ast = parse("echo hello");
        match ast {
            AstNode::Command(cmd) => {
                assert_eq!(word_to_string(&cmd.name), "echo");
                assert_eq!(cmd.args.len(), 1);
                assert_eq!(word_to_string(&cmd.args[0]), "hello");
            }
            _ => panic!("Expected Command node"),
        }
    }

    #[test]
    fn test_pipeline() {
        let ast = parse("ls | grep foo");
        match ast {
            AstNode::Pipeline(p) => {
                assert_eq!(p.commands.len(), 2);
                assert!(!p.negated);
            }
            _ => panic!("Expected Pipeline node"),
        }
    }

    #[test]
    fn test_assignment() {
        let ast = parse("FOO=bar");
        match ast {
            AstNode::Assignment(a) => {
                assert_eq!(a.name, "FOO");
                assert_eq!(word_to_string(&a.value), "bar");
            }
            _ => panic!("Expected Assignment node"),
        }
    }

    #[test]
    fn test_if_statement() {
        let ast = parse("if true; then echo yes; fi");
        match ast {
            AstNode::If(if_node) => {
                assert_eq!(if_node.clauses.len(), 1);
                assert!(if_node.else_body.is_none());
            }
            _ => panic!("Expected If node"),
        }
    }

    #[test]
    fn test_for_loop() {
        let ast = parse("for i in a b c; do echo $i; done");
        match ast {
            AstNode::For(for_node) => {
                assert_eq!(for_node.variable, "i");
                assert!(for_node.words.is_some());
                assert_eq!(for_node.words.as_ref().unwrap().len(), 3);
            }
            _ => panic!("Expected For node"),
        }
    }

    #[test]
    fn test_variable_expansion() {
        let ast = parse("echo $HOME");
        match ast {
            AstNode::Command(cmd) => {
                assert_eq!(cmd.args.len(), 1);
                match &cmd.args[0][0] {
                    WordPart::Variable { name, .. } => assert_eq!(name, "HOME"),
                    _ => panic!("Expected Variable"),
                }
            }
            _ => panic!("Expected Command"),
        }
    }

    #[test]
    fn test_and_or() {
        let ast = parse("true && echo yes || echo no");
        match ast {
            AstNode::List(_) => {} // correct
            _ => panic!("Expected List node"),
        }
    }

    #[test]
    fn test_redirect() {
        let ast = parse("echo hi > file.txt");
        match ast {
            AstNode::Command(cmd) => {
                assert_eq!(cmd.redirects.len(), 1);
                assert_eq!(cmd.redirects[0].op, ">");
            }
            _ => panic!("Expected Command"),
        }
    }

    #[test]
    fn test_command_substitution() {
        let ast = parse("echo $(date)");
        match ast {
            AstNode::Command(cmd) => {
                assert_eq!(cmd.args.len(), 1);
                match &cmd.args[0][0] {
                    WordPart::CommandSubstitution { .. } => {}
                    _ => panic!("Expected CommandSubstitution"),
                }
            }
            _ => panic!("Expected Command"),
        }
    }

    #[test]
    fn test_arithmetic() {
        let ast = parse("echo $((1 + 2))");
        match ast {
            AstNode::Command(cmd) => {
                assert_eq!(cmd.args.len(), 1);
                match &cmd.args[0][0] {
                    WordPart::ArithmeticExpansion { expression } => {
                        assert_eq!(expression, "1 + 2");
                    }
                    _ => panic!("Expected ArithmeticExpansion"),
                }
            }
            _ => panic!("Expected Command"),
        }
    }

    #[test]
    fn test_serialization() {
        let ast = parse("echo hello");
        let json = serde_json::to_string(&ast).unwrap();
        assert!(json.contains("\"type\":\"command\""));
        assert!(json.contains("echo"));
    }

    #[test]
    fn test_positional_param() {
        let ast = parse("echo $1");
        match ast {
            AstNode::Command(cmd) => {
                assert_eq!(cmd.args.len(), 1);
                match &cmd.args[0][0] {
                    WordPart::Variable { name, .. } => assert_eq!(name, "1"),
                    other => panic!("Expected Variable, got {:?}", other),
                }
            }
            _ => panic!("Expected Command"),
        }
    }

    #[test]
    fn test_positional_in_double_quotes() {
        let ast = parse(r#"echo "Hello, $1!""#);
        match ast {
            AstNode::Command(cmd) => {
                assert_eq!(cmd.args.len(), 1);
                match &cmd.args[0][0] {
                    WordPart::DoubleQuoted { parts } => {
                        // Should have: Literal("Hello, "), Variable("1"), Literal("!")
                        assert!(
                            parts.len() >= 2,
                            "Expected at least 2 parts, got {:?}",
                            parts
                        );
                        match &parts[1] {
                            WordPart::Variable { name, .. } => assert_eq!(name, "1"),
                            other => panic!("Expected Variable for $1, got {:?}", other),
                        }
                    }
                    other => panic!("Expected DoubleQuoted, got {:?}", other),
                }
            }
            _ => panic!("Expected Command"),
        }
    }
}
