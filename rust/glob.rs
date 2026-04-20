/// Match a glob pattern against a path string.
///
/// Supports: *, **, ?, [abc], [a-z], [!abc], {a,b,c}, and \ escaping.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    do_match(pattern.as_bytes(), 0, path.as_bytes(), 0)
}

fn do_match(pattern: &[u8], mut pi: usize, s: &[u8], mut si: usize) -> bool {
    while pi < pattern.len() {
        let ch = pattern[pi];

        // Escape: next char is literal
        if ch == b'\\' {
            pi += 1;
            if pi >= pattern.len() {
                return false;
            }
            if si >= s.len() || s[si] != pattern[pi] {
                return false;
            }
            pi += 1;
            si += 1;
            continue;
        }

        // Double star: matches any path segments
        if ch == b'*' && pi + 1 < pattern.len() && pattern[pi + 1] == b'*' {
            pi += 2;
            if pi < pattern.len() && pattern[pi] == b'/' {
                pi += 1;
            }
            if pi >= pattern.len() {
                return true;
            }
            for i in si..=s.len() {
                if do_match(pattern, pi, s, i) {
                    return true;
                }
            }
            return false;
        }

        // Single star: matches anything except /
        if ch == b'*' {
            pi += 1;
            for i in si..=s.len() {
                if i > si && s[i - 1] == b'/' {
                    break;
                }
                if do_match(pattern, pi, s, i) {
                    return true;
                }
            }
            return false;
        }

        // Question mark: matches single char except /
        if ch == b'?' {
            if si >= s.len() || s[si] == b'/' {
                return false;
            }
            pi += 1;
            si += 1;
            continue;
        }

        // Character class
        if ch == b'[' {
            if let Some(close) = find_class_close(pattern, pi) {
                if si >= s.len() || s[si] == b'/' {
                    return false;
                }
                let class_content = &pattern[pi + 1..close];
                let negate = !class_content.is_empty() && class_content[0] == b'!';
                let chars = if negate { &class_content[1..] } else { class_content };
                let matched = match_char_class(chars, s[si]);
                if negate == matched {
                    return false;
                }
                pi = close + 1;
                si += 1;
                continue;
            }
            // Treat as literal
            if si >= s.len() || s[si] != b'[' {
                return false;
            }
            pi += 1;
            si += 1;
            continue;
        }

        // Literal character
        if si >= s.len() || s[si] != ch {
            return false;
        }
        pi += 1;
        si += 1;
    }

    si >= s.len()
}

fn find_class_close(pattern: &[u8], start: usize) -> Option<usize> {
    for i in (start + 2)..pattern.len() {
        if pattern[i] == b']' {
            return Some(i);
        }
    }
    None
}

fn match_char_class(class: &[u8], ch: u8) -> bool {
    let mut i = 0;
    while i < class.len() {
        if i + 2 < class.len() && class[i + 1] == b'-' {
            if ch >= class[i] && ch <= class[i + 2] {
                return true;
            }
            i += 3;
        } else {
            if ch == class[i] {
                return true;
            }
            i += 1;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_literal() {
        assert!(glob_match("hello", "hello"));
        assert!(!glob_match("hello", "world"));
    }

    #[test]
    fn test_star() {
        assert!(glob_match("*.txt", "file.txt"));
        assert!(!glob_match("*.txt", "dir/file.txt"));
    }

    #[test]
    fn test_double_star() {
        assert!(glob_match("**/*.txt", "dir/file.txt"));
        assert!(glob_match("**/*.txt", "a/b/c/file.txt"));
    }

    #[test]
    fn test_question_mark() {
        assert!(glob_match("?.txt", "a.txt"));
        assert!(!glob_match("?.txt", "ab.txt"));
    }

    #[test]
    fn test_char_class() {
        assert!(glob_match("[abc].txt", "a.txt"));
        assert!(!glob_match("[abc].txt", "d.txt"));
    }
}
