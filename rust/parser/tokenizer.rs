#[derive(Debug, Clone, PartialEq)]
pub enum TokenType {
    Word,
    AssignmentWord,
    Newline,
    Eof,
    Pipe,
    PipeAnd,
    And,
    Or,
    Semi,
    Amp,
    DSemi,
    SemiAnd,
    DSemiAnd,
    Less,
    Great,
    DLess,
    DGreat,
    LessAnd,
    GreatAnd,
    LessGreat,
    DLessDash,
    Clobber,
    AndGreat,
    AndDGreat,
    TLess,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Bang,
    If,
    Then,
    Else,
    Elif,
    Fi,
    For,
    While,
    Until,
    Do,
    Done,
    Case,
    Esac,
    In,
    Select,
    Function,
    Coproc,
    Time,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub token_type: TokenType,
    pub value: String,
}

struct PendingHeredoc {
    delimiter: String,
    strip_tabs: bool,
    quoted: bool,
    token_index: usize,
}

pub struct Tokenizer {
    input: Vec<char>,
    pos: usize,
    peeked: Option<Token>,
    reserved_word_context: bool,
    pending_heredocs: Vec<PendingHeredoc>,
    tokens_emitted: Vec<Token>,
}

impl Tokenizer {
    pub fn new(input: &str) -> Self {
        Tokenizer {
            input: input.chars().collect(),
            pos: 0,
            peeked: None,
            reserved_word_context: true,
            pending_heredocs: Vec::new(),
            tokens_emitted: Vec::new(),
        }
    }

    fn ch(&self) -> char {
        if self.pos < self.input.len() {
            self.input[self.pos]
        } else {
            '\0'
        }
    }

    fn lookahead(&self, n: usize) -> char {
        if self.pos + n < self.input.len() {
            self.input[self.pos + n]
        } else {
            '\0'
        }
    }

    fn advance(&mut self) -> char {
        let c = self.input[self.pos];
        self.pos += 1;
        c
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() {
            let c = self.ch();
            if c == ' ' || c == '\t' {
                self.advance();
            } else if c == '\\' && self.lookahead(1) == '\n' {
                self.advance();
                self.advance();
            } else {
                break;
            }
        }
    }

    fn skip_comment(&mut self) {
        if self.ch() == '#' {
            while self.pos < self.input.len() && self.ch() != '\n' {
                self.advance();
            }
        }
    }

    fn read_single_quoted(&mut self) -> String {
        let mut value = String::new();
        while self.pos < self.input.len() {
            let c = self.ch();
            if c == '\'' {
                self.advance();
                return value;
            }
            value.push(self.advance());
        }
        value // unterminated — return what we have
    }

    fn read_double_quoted(&mut self) -> String {
        let mut value = String::new();
        while self.pos < self.input.len() {
            let c = self.ch();
            if c == '"' {
                self.advance();
                return value;
            }
            if c == '\\' {
                let next = self.lookahead(1);
                if next == '$' || next == '`' || next == '"' || next == '\\' || next == '\n' {
                    self.advance();
                    if next == '\n' {
                        self.advance();
                        continue;
                    }
                    value.push(self.advance());
                    continue;
                }
            }
            if c == '$' {
                value.push_str(&self.read_dollar_raw());
                continue;
            }
            if c == '`' {
                value.push_str(&self.read_backtick_raw());
                continue;
            }
            value.push(self.advance());
        }
        value
    }

    fn read_dollar_raw(&mut self) -> String {
        let mut result = String::new();
        result.push(self.advance()); // $
        let c = self.ch();

        if c == '(' {
            if self.lookahead(1) == '(' {
                // $(( ... ))
                result.push(self.advance()); // (
                result.push(self.advance()); // (
                let mut depth = 1;
                while self.pos < self.input.len() && depth > 0 {
                    if self.ch() == '(' && self.lookahead(1) == '(' {
                        depth += 1;
                        result.push(self.advance());
                        result.push(self.advance());
                    } else if self.ch() == ')' && self.lookahead(1) == ')' {
                        depth -= 1;
                        result.push(self.advance());
                        result.push(self.advance());
                    } else {
                        result.push(self.advance());
                    }
                }
            } else {
                // $( ... )
                result.push(self.advance()); // (
                let mut depth = 1;
                while self.pos < self.input.len() && depth > 0 {
                    let ch = self.ch();
                    if ch == '(' {
                        depth += 1;
                    }
                    if ch == ')' {
                        depth -= 1;
                    }
                    if depth > 0 {
                        if ch == '\'' {
                            result.push(self.advance());
                            while self.pos < self.input.len() && self.ch() != '\'' {
                                result.push(self.advance());
                            }
                            if self.ch() == '\'' {
                                result.push(self.advance());
                            }
                        } else if ch == '"' {
                            result.push(self.advance());
                            result.push_str(&self.read_double_quoted());
                            result.push('"');
                        } else {
                            result.push(self.advance());
                        }
                    } else {
                        result.push(self.advance());
                    }
                }
            }
        } else if c == '{' {
            result.push(self.advance()); // {
            let mut depth = 1;
            while self.pos < self.input.len() && depth > 0 {
                let ch = self.ch();
                if ch == '{' {
                    depth += 1;
                }
                if ch == '}' {
                    depth -= 1;
                }
                if depth > 0 {
                    if ch == '\'' {
                        result.push(self.advance());
                        while self.pos < self.input.len() && self.ch() != '\'' {
                            result.push(self.advance());
                        }
                        if self.ch() == '\'' {
                            result.push(self.advance());
                        }
                    } else if ch == '"' {
                        result.push(self.advance());
                        result.push_str(&self.read_double_quoted());
                        result.push('"');
                    } else {
                        result.push(self.advance());
                    }
                } else {
                    result.push(self.advance());
                }
            }
        } else if is_name_char(c) || is_special_param(c) {
            if is_special_param(c) {
                result.push(self.advance());
            } else {
                while self.pos < self.input.len() && is_name_char(self.ch()) {
                    result.push(self.advance());
                }
            }
        }

        result
    }

    fn read_backtick_raw(&mut self) -> String {
        let mut result = String::new();
        result.push(self.advance()); // `
        while self.pos < self.input.len() {
            let c = self.ch();
            if c == '`' {
                result.push(self.advance());
                return result;
            }
            if c == '\\' {
                result.push(self.advance());
                if self.pos < self.input.len() {
                    result.push(self.advance());
                }
                continue;
            }
            result.push(self.advance());
        }
        result
    }

    fn read_word(&mut self) -> String {
        let mut word = String::new();
        while self.pos < self.input.len() {
            let c = self.ch();

            if c == '\\' {
                self.advance();
                if self.pos < self.input.len() {
                    if self.ch() == '\n' {
                        self.advance();
                        continue;
                    }
                    word.push(self.advance());
                }
                continue;
            }

            if c == '\'' {
                word.push(c);
                self.advance();
                word.push_str(&self.read_single_quoted());
                word.push('\'');
                continue;
            }

            if c == '"' {
                word.push(c);
                self.advance();
                word.push_str(&self.read_double_quoted());
                word.push('"');
                continue;
            }

            if c == '$' {
                word.push_str(&self.read_dollar_raw());
                continue;
            }

            if c == '`' {
                word.push_str(&self.read_backtick_raw());
                continue;
            }

            if is_meta_char(c) {
                break;
            }

            word.push(self.advance());
        }
        word
    }

    fn is_assignment_word(word: &str) -> bool {
        let chars: Vec<char> = word.chars().collect();
        let mut i = 0;
        if i < chars.len() && (chars[i].is_ascii_alphabetic() || chars[i] == '_') {
            i += 1;
            while i < chars.len() && is_name_char(chars[i]) {
                i += 1;
            }
            if i < chars.len() {
                if chars[i] == '=' {
                    return true;
                }
                if chars[i] == '+' && i + 1 < chars.len() && chars[i + 1] == '=' {
                    return true;
                }
            }
        }
        false
    }

    fn read_heredoc_bodies(&mut self) {
        if self.pending_heredocs.is_empty() {
            return;
        }

        let heredocs: Vec<PendingHeredoc> = self.pending_heredocs.drain(..).collect();

        for hd in heredocs {
            let mut body = String::new();
            while self.pos < self.input.len() {
                let mut line = String::new();
                while self.pos < self.input.len() && self.ch() != '\n' {
                    line.push(self.advance());
                }
                if self.pos < self.input.len() {
                    self.advance(); // consume \n
                }

                let trimmed_line = if hd.strip_tabs {
                    line.trim_start_matches('\t').to_string()
                } else {
                    line.clone()
                };

                if trimmed_line == hd.delimiter {
                    break;
                }

                body.push_str(&line);
                body.push('\n');
            }

            // Attach body to the emitted token via special encoding
            if let Some(token) = self.tokens_emitted.get_mut(hd.token_index) {
                let quoted = if hd.quoted { "1" } else { "0" };
                token.value = format!("{}\x00{}\x00{}", token.value, body, quoted);
            }
        }
    }

    pub fn next(&mut self) -> Token {
        if let Some(t) = self.peeked.take() {
            return t;
        }
        self.read_token()
    }

    pub fn peek(&mut self) -> &Token {
        if self.peeked.is_none() {
            self.peeked = Some(self.read_token());
        }
        self.peeked.as_ref().unwrap()
    }

    fn read_token(&mut self) -> Token {
        self.skip_whitespace();
        self.skip_comment();

        if self.pos >= self.input.len() {
            return Token {
                token_type: TokenType::Eof,
                value: String::new(),
            };
        }

        let c = self.ch();

        // Newline
        if c == '\n' {
            self.advance();
            self.read_heredoc_bodies();
            self.reserved_word_context = true;
            return Token {
                token_type: TokenType::Newline,
                value: "\n".to_string(),
            };
        }

        // Operators
        if let Some(op) = self.try_read_operator() {
            match op.token_type {
                TokenType::Pipe
                | TokenType::PipeAnd
                | TokenType::And
                | TokenType::Or
                | TokenType::Semi
                | TokenType::Amp
                | TokenType::LParen => {
                    self.reserved_word_context = true;
                }
                _ => {
                    self.reserved_word_context = false;
                }
            }
            let idx = self.tokens_emitted.len();
            self.tokens_emitted.push(op.clone());

            // Check for heredoc registration
            if op.token_type == TokenType::DLess || op.token_type == TokenType::DLessDash {
                let strip_tabs = op.token_type == TokenType::DLessDash;
                self.skip_whitespace();
                let delim_raw = self.read_word();

                // Check if delimiter is quoted
                let quoted = delim_raw.contains('\'') || delim_raw.contains('"');
                let delimiter = delim_raw
                    .replace('\'', "")
                    .replace('"', "")
                    .replace('\\', "");

                self.pending_heredocs.push(PendingHeredoc {
                    delimiter,
                    strip_tabs,
                    quoted,
                    token_index: idx,
                });

                return self.tokens_emitted.last().unwrap().clone();
            }

            return op;
        }

        // Words
        let word = self.read_word();
        if word.is_empty() {
            // Skip unexpected character
            self.advance();
            return self.read_token();
        }

        // Assignment word
        if Self::is_assignment_word(&word) {
            self.reserved_word_context = true;
            let tok = Token {
                token_type: TokenType::AssignmentWord,
                value: word,
            };
            self.tokens_emitted.push(tok.clone());
            return tok;
        }

        // Reserved words
        if self.reserved_word_context {
            let tt = match word.as_str() {
                "if" => Some(TokenType::If),
                "then" => Some(TokenType::Then),
                "else" => Some(TokenType::Else),
                "elif" => Some(TokenType::Elif),
                "fi" => Some(TokenType::Fi),
                "for" => Some(TokenType::For),
                "while" => Some(TokenType::While),
                "until" => Some(TokenType::Until),
                "do" => Some(TokenType::Do),
                "done" => Some(TokenType::Done),
                "case" => Some(TokenType::Case),
                "esac" => Some(TokenType::Esac),
                "in" => Some(TokenType::In),
                "select" => Some(TokenType::Select),
                "function" => Some(TokenType::Function),
                "coproc" => Some(TokenType::Coproc),
                "time" => Some(TokenType::Time),
                _ => None,
            };
            if let Some(token_type) = tt {
                match token_type {
                    TokenType::If
                    | TokenType::Then
                    | TokenType::Else
                    | TokenType::Elif
                    | TokenType::Do
                    | TokenType::While
                    | TokenType::Until
                    | TokenType::For
                    | TokenType::Select
                    | TokenType::Case
                    | TokenType::Time
                    | TokenType::Function => {
                        self.reserved_word_context = true;
                    }
                    _ => {
                        self.reserved_word_context = false;
                    }
                }
                let tok = Token {
                    token_type,
                    value: word,
                };
                self.tokens_emitted.push(tok.clone());
                return tok;
            }
        }

        self.reserved_word_context = false;
        let tok = Token {
            token_type: TokenType::Word,
            value: word,
        };
        self.tokens_emitted.push(tok.clone());
        tok
    }

    fn try_read_operator(&mut self) -> Option<Token> {
        let c = self.ch();
        let c2 = self.lookahead(1);
        let c3 = self.lookahead(2);

        match c {
            '|' => {
                if c2 == '|' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Or,
                        value: "||".to_string(),
                    })
                } else if c2 == '&' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::PipeAnd,
                        value: "|&".to_string(),
                    })
                } else {
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Pipe,
                        value: "|".to_string(),
                    })
                }
            }
            '&' => {
                if c2 == '&' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::And,
                        value: "&&".to_string(),
                    })
                } else if c2 == '>' {
                    if c3 == '>' {
                        self.advance();
                        self.advance();
                        self.advance();
                        Some(Token {
                            token_type: TokenType::AndDGreat,
                            value: "&>>".to_string(),
                        })
                    } else {
                        self.advance();
                        self.advance();
                        Some(Token {
                            token_type: TokenType::AndGreat,
                            value: "&>".to_string(),
                        })
                    }
                } else {
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Amp,
                        value: "&".to_string(),
                    })
                }
            }
            ';' => {
                if c2 == ';' {
                    if c3 == '&' {
                        self.advance();
                        self.advance();
                        self.advance();
                        Some(Token {
                            token_type: TokenType::DSemiAnd,
                            value: ";;&".to_string(),
                        })
                    } else {
                        self.advance();
                        self.advance();
                        Some(Token {
                            token_type: TokenType::DSemi,
                            value: ";;".to_string(),
                        })
                    }
                } else if c2 == '&' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::SemiAnd,
                        value: ";&".to_string(),
                    })
                } else {
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Semi,
                        value: ";".to_string(),
                    })
                }
            }
            '<' => {
                if c2 == '<' {
                    if c3 == '<' {
                        self.advance();
                        self.advance();
                        self.advance();
                        Some(Token {
                            token_type: TokenType::TLess,
                            value: "<<<".to_string(),
                        })
                    } else if c3 == '-' {
                        self.advance();
                        self.advance();
                        self.advance();
                        Some(Token {
                            token_type: TokenType::DLessDash,
                            value: "<<-".to_string(),
                        })
                    } else {
                        self.advance();
                        self.advance();
                        Some(Token {
                            token_type: TokenType::DLess,
                            value: "<<".to_string(),
                        })
                    }
                } else if c2 == '&' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::LessAnd,
                        value: "<&".to_string(),
                    })
                } else if c2 == '>' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::LessGreat,
                        value: "<>".to_string(),
                    })
                } else if c2 == '(' {
                    None // process substitution
                } else {
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Less,
                        value: "<".to_string(),
                    })
                }
            }
            '>' => {
                if c2 == '>' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::DGreat,
                        value: ">>".to_string(),
                    })
                } else if c2 == '&' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::GreatAnd,
                        value: ">&".to_string(),
                    })
                } else if c2 == '|' {
                    self.advance();
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Clobber,
                        value: ">|".to_string(),
                    })
                } else if c2 == '(' {
                    None // process substitution
                } else {
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Great,
                        value: ">".to_string(),
                    })
                }
            }
            '(' => {
                self.advance();
                Some(Token {
                    token_type: TokenType::LParen,
                    value: "(".to_string(),
                })
            }
            ')' => {
                self.advance();
                Some(Token {
                    token_type: TokenType::RParen,
                    value: ")".to_string(),
                })
            }
            '!' => {
                if c2 == '\0'
                    || c2 == ' '
                    || c2 == '\t'
                    || c2 == '\n'
                    || is_meta_char(c2)
                {
                    self.advance();
                    Some(Token {
                        token_type: TokenType::Bang,
                        value: "!".to_string(),
                    })
                } else {
                    None
                }
            }
            '{' => {
                if c2 == ' ' || c2 == '\t' || c2 == '\n' || c2 == '\0' {
                    self.advance();
                    self.reserved_word_context = true;
                    Some(Token {
                        token_type: TokenType::LBrace,
                        value: "{".to_string(),
                    })
                } else {
                    None
                }
            }
            '}' => {
                self.advance();
                Some(Token {
                    token_type: TokenType::RBrace,
                    value: "}".to_string(),
                })
            }
            _ => None,
        }
    }
}

fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_special_param(c: char) -> bool {
    matches!(c, '@' | '*' | '#' | '?' | '-' | '$' | '!')
}

fn is_meta_char(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '|' | '&' | ';' | '(' | ')' | '<' | '>')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_command() {
        let mut tok = Tokenizer::new("echo hello");
        assert_eq!(tok.next().value, "echo");
        assert_eq!(tok.next().value, "hello");
        assert_eq!(tok.next().token_type, TokenType::Eof);
    }

    #[test]
    fn test_pipe() {
        let mut tok = Tokenizer::new("ls | grep foo");
        assert_eq!(tok.next().value, "ls");
        assert_eq!(tok.next().token_type, TokenType::Pipe);
        assert_eq!(tok.next().value, "grep");
        assert_eq!(tok.next().value, "foo");
    }

    #[test]
    fn test_assignment() {
        let mut tok = Tokenizer::new("FOO=bar");
        let t = tok.next();
        assert_eq!(t.token_type, TokenType::AssignmentWord);
        assert_eq!(t.value, "FOO=bar");
    }

    #[test]
    fn test_reserved_words() {
        let mut tok = Tokenizer::new("if true; then echo yes; fi");
        assert_eq!(tok.next().token_type, TokenType::If);
        assert_eq!(tok.next().value, "true");
        assert_eq!(tok.next().token_type, TokenType::Semi);
        assert_eq!(tok.next().token_type, TokenType::Then);
    }

    #[test]
    fn test_single_quotes() {
        let mut tok = Tokenizer::new("echo 'hello world'");
        assert_eq!(tok.next().value, "echo");
        assert_eq!(tok.next().value, "'hello world'");
    }

    #[test]
    fn test_double_quotes() {
        let mut tok = Tokenizer::new("echo \"hello $name\"");
        assert_eq!(tok.next().value, "echo");
        assert_eq!(tok.next().value, "\"hello $name\"");
    }

    #[test]
    fn test_redirects() {
        let mut tok = Tokenizer::new("echo hi > file.txt");
        assert_eq!(tok.next().value, "echo");
        assert_eq!(tok.next().value, "hi");
        assert_eq!(tok.next().token_type, TokenType::Great);
        assert_eq!(tok.next().value, "file.txt");
    }
}
