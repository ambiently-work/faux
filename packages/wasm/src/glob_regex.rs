/// Convert a glob pattern to a regex source string.
pub fn to_regex(pattern: &str) -> String {
    let mut regex = String::from("^");
    let bytes = pattern.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b'*' => {
                regex.push_str(".*");
                i += 1;
            }
            b'?' => {
                regex.push('.');
                i += 1;
            }
            b'[' => {
                let mut j = i + 1;
                let mut cls = String::from("[");
                if j < bytes.len() && bytes[j] == b'!' {
                    cls.push('^');
                    j += 1;
                }
                while j < bytes.len() && bytes[j] != b']' {
                    cls.push(bytes[j] as char);
                    j += 1;
                }
                cls.push(']');
                regex.push_str(&cls);
                i = j + 1;
            }
            b'\\' => {
                if i + 1 < bytes.len() {
                    regex.push('\\');
                    regex.push(bytes[i + 1] as char);
                    i += 2;
                } else {
                    i += 1;
                }
            }
            ch => {
                // Escape regex special characters
                let c = ch as char;
                if ".*+?^${}()|[]\\".contains(c) {
                    regex.push('\\');
                }
                regex.push(c);
                i += 1;
            }
        }
    }

    regex.push('$');
    regex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_literal() {
        assert_eq!(to_regex("hello"), "^hello$");
    }

    #[test]
    fn test_star() {
        assert_eq!(to_regex("*.txt"), "^.*\\.txt$");
    }

    #[test]
    fn test_question() {
        assert_eq!(to_regex("?.txt"), "^.\\.txt$");
    }

    #[test]
    fn test_char_class() {
        assert_eq!(to_regex("[abc]"), "^[abc]$");
    }

    #[test]
    fn test_negated_class() {
        assert_eq!(to_regex("[!abc]"), "^[^abc]$");
    }
}
