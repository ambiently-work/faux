/// Evaluate a pre-resolved arithmetic expression (no variables, only numbers and operators).
pub fn evaluate(expr: &str) -> i64 {
    let tokens = tokenize(expr);
    let mut cursor = 0;
    parse_expr(&tokens, &mut cursor)
}

fn tokenize(expr: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let bytes = expr.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' => i += 1,
            b'0'..=b'9' => {
                let start = i;
                while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'.') {
                    i += 1;
                }
                let s = &expr[start..i];
                let num = parse_number(s);
                tokens.push(Token::Num(num));
            }
            _ => {
                // Two-char operators
                if i + 1 < bytes.len() {
                    let two = &expr[i..i + 2];
                    match two {
                        "<=" | ">=" | "==" | "!=" | "&&" | "||" | "<<" | ">>" | "**" => {
                            tokens.push(Token::Op(two.to_string()));
                            i += 2;
                            continue;
                        }
                        _ => {}
                    }
                }
                tokens.push(Token::Op((bytes[i] as char).to_string()));
                i += 1;
            }
        }
    }

    tokens
}

fn parse_number(s: &str) -> i64 {
    if s.starts_with("0x") || s.starts_with("0X") {
        i64::from_str_radix(&s[2..], 16).unwrap_or(0)
    } else if s.starts_with('0') && s.len() > 1 && !s.contains('.') {
        i64::from_str_radix(&s[1..], 8).unwrap_or(0)
    } else {
        s.parse::<f64>().map(|n| n as i64).unwrap_or(0)
    }
}

#[derive(Debug, Clone)]
enum Token {
    Num(i64),
    Op(String),
}

fn peek_op<'a>(tokens: &'a [Token], cursor: &usize) -> Option<&'a str> {
    if *cursor < tokens.len() {
        if let Token::Op(ref s) = tokens[*cursor] {
            return Some(s.as_str());
        }
    }
    None
}

fn consume(tokens: &[Token], cursor: &mut usize) {
    *cursor += 1;
    let _ = tokens; // suppress unused warning
}

fn parse_expr(tokens: &[Token], cursor: &mut usize) -> i64 {
    parse_ternary(tokens, cursor)
}

fn parse_ternary(tokens: &[Token], cursor: &mut usize) -> i64 {
    let cond = parse_logical_or(tokens, cursor);
    if peek_op(tokens, cursor) == Some("?") {
        consume(tokens, cursor);
        let true_val = parse_expr(tokens, cursor);
        if peek_op(tokens, cursor) == Some(":") {
            consume(tokens, cursor);
        }
        let false_val = parse_expr(tokens, cursor);
        if cond != 0 {
            true_val
        } else {
            false_val
        }
    } else {
        cond
    }
}

fn parse_logical_or(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_logical_and(tokens, cursor);
    while peek_op(tokens, cursor) == Some("||") {
        consume(tokens, cursor);
        let right = parse_logical_and(tokens, cursor);
        left = if left != 0 || right != 0 { 1 } else { 0 };
    }
    left
}

fn parse_logical_and(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_bitwise_or(tokens, cursor);
    while peek_op(tokens, cursor) == Some("&&") {
        consume(tokens, cursor);
        let right = parse_bitwise_or(tokens, cursor);
        left = if left != 0 && right != 0 { 1 } else { 0 };
    }
    left
}

fn parse_bitwise_or(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_bitwise_xor(tokens, cursor);
    while peek_op(tokens, cursor) == Some("|") {
        consume(tokens, cursor);
        left |= parse_bitwise_xor(tokens, cursor);
    }
    left
}

fn parse_bitwise_xor(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_bitwise_and(tokens, cursor);
    while peek_op(tokens, cursor) == Some("^") {
        consume(tokens, cursor);
        left ^= parse_bitwise_and(tokens, cursor);
    }
    left
}

fn parse_bitwise_and(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_equality(tokens, cursor);
    while peek_op(tokens, cursor) == Some("&") {
        consume(tokens, cursor);
        left &= parse_equality(tokens, cursor);
    }
    left
}

fn parse_equality(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_relational(tokens, cursor);
    loop {
        match peek_op(tokens, cursor) {
            Some("==") => {
                consume(tokens, cursor);
                let right = parse_relational(tokens, cursor);
                left = if left == right { 1 } else { 0 };
            }
            Some("!=") => {
                consume(tokens, cursor);
                let right = parse_relational(tokens, cursor);
                left = if left != right { 1 } else { 0 };
            }
            _ => break,
        }
    }
    left
}

fn parse_relational(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_shift(tokens, cursor);
    loop {
        match peek_op(tokens, cursor) {
            Some("<") => {
                consume(tokens, cursor);
                let r = parse_shift(tokens, cursor);
                left = if left < r { 1 } else { 0 };
            }
            Some(">") => {
                consume(tokens, cursor);
                let r = parse_shift(tokens, cursor);
                left = if left > r { 1 } else { 0 };
            }
            Some("<=") => {
                consume(tokens, cursor);
                let r = parse_shift(tokens, cursor);
                left = if left <= r { 1 } else { 0 };
            }
            Some(">=") => {
                consume(tokens, cursor);
                let r = parse_shift(tokens, cursor);
                left = if left >= r { 1 } else { 0 };
            }
            _ => break,
        }
    }
    left
}

fn parse_shift(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_add_sub(tokens, cursor);
    loop {
        match peek_op(tokens, cursor) {
            Some("<<") => {
                consume(tokens, cursor);
                left <<= parse_add_sub(tokens, cursor);
            }
            Some(">>") => {
                consume(tokens, cursor);
                left >>= parse_add_sub(tokens, cursor);
            }
            _ => break,
        }
    }
    left
}

fn parse_add_sub(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_mul_div(tokens, cursor);
    loop {
        match peek_op(tokens, cursor) {
            Some("+") => {
                consume(tokens, cursor);
                left += parse_mul_div(tokens, cursor);
            }
            Some("-") => {
                consume(tokens, cursor);
                left -= parse_mul_div(tokens, cursor);
            }
            _ => break,
        }
    }
    left
}

fn parse_mul_div(tokens: &[Token], cursor: &mut usize) -> i64 {
    let mut left = parse_exponent(tokens, cursor);
    loop {
        match peek_op(tokens, cursor) {
            Some("*") => {
                consume(tokens, cursor);
                left *= parse_exponent(tokens, cursor);
            }
            Some("/") => {
                consume(tokens, cursor);
                let right = parse_exponent(tokens, cursor);
                left = if right != 0 { left / right } else { 0 };
            }
            Some("%") => {
                consume(tokens, cursor);
                let right = parse_exponent(tokens, cursor);
                left = if right != 0 { left % right } else { 0 };
            }
            _ => break,
        }
    }
    left
}

fn parse_exponent(tokens: &[Token], cursor: &mut usize) -> i64 {
    let base = parse_unary(tokens, cursor);
    if peek_op(tokens, cursor) == Some("**") {
        consume(tokens, cursor);
        let exp = parse_exponent(tokens, cursor);
        base.pow(exp as u32)
    } else {
        base
    }
}

fn parse_unary(tokens: &[Token], cursor: &mut usize) -> i64 {
    match peek_op(tokens, cursor) {
        Some("-") => {
            consume(tokens, cursor);
            -parse_unary(tokens, cursor)
        }
        Some("+") => {
            consume(tokens, cursor);
            parse_unary(tokens, cursor)
        }
        Some("!") => {
            consume(tokens, cursor);
            if parse_unary(tokens, cursor) == 0 {
                1
            } else {
                0
            }
        }
        Some("~") => {
            consume(tokens, cursor);
            !parse_unary(tokens, cursor)
        }
        _ => parse_primary(tokens, cursor),
    }
}

fn parse_primary(tokens: &[Token], cursor: &mut usize) -> i64 {
    if *cursor >= tokens.len() {
        return 0;
    }

    if peek_op(tokens, cursor) == Some("(") {
        consume(tokens, cursor);
        let val = parse_expr(tokens, cursor);
        if peek_op(tokens, cursor) == Some(")") {
            consume(tokens, cursor);
        }
        return val;
    }

    match &tokens[*cursor] {
        Token::Num(n) => {
            let val = *n;
            *cursor += 1;
            val
        }
        _ => {
            *cursor += 1;
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_arithmetic() {
        assert_eq!(evaluate("2 + 3"), 5);
        assert_eq!(evaluate("10 - 3"), 7);
        assert_eq!(evaluate("4 * 5"), 20);
        assert_eq!(evaluate("10 / 3"), 3);
    }

    #[test]
    fn test_precedence() {
        assert_eq!(evaluate("2 + 3 * 4"), 14);
        assert_eq!(evaluate("(2 + 3) * 4"), 20);
    }

    #[test]
    fn test_exponent() {
        assert_eq!(evaluate("2 ** 10"), 1024);
    }

    #[test]
    fn test_bitwise() {
        assert_eq!(evaluate("5 & 3"), 1);
        assert_eq!(evaluate("5 | 3"), 7);
        assert_eq!(evaluate("5 ^ 3"), 6);
    }

    #[test]
    fn test_ternary() {
        assert_eq!(evaluate("1 ? 42 : 0"), 42);
        assert_eq!(evaluate("0 ? 42 : 99"), 99);
    }
}
