/// Expand brace expressions: {a,b,c}, {1..10}, {a..z}, nested.
pub fn expand(word: &str) -> Vec<String> {
    let brace_start = match word.find('{') {
        Some(i) => i,
        None => return vec![word.to_string()],
    };

    let brace_end = match find_matching_brace(word, brace_start) {
        Some(i) => i,
        None => return vec![word.to_string()],
    };

    let prefix = &word[..brace_start];
    let suffix = &word[brace_end + 1..];
    let inner = &word[brace_start + 1..brace_end];

    // Check for numeric sequence: {1..10} or {1..10..2}
    if let Some(results) = try_numeric_sequence(prefix, inner, suffix) {
        return results;
    }

    // Check for character sequence: {a..z}
    if let Some(results) = try_char_sequence(prefix, inner, suffix) {
        return results;
    }

    // Comma-separated alternatives
    let alternatives = split_alternatives(inner);
    let mut results = Vec::new();
    for alt in alternatives {
        let combined = format!("{prefix}{alt}{suffix}");
        results.extend(expand(&combined));
    }
    results
}

fn find_matching_brace(s: &str, start: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth = 0;
    let mut escaped = false;
    for i in start..bytes.len() {
        if escaped {
            escaped = false;
            continue;
        }
        if bytes[i] == b'\\' {
            escaped = true;
            continue;
        }
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

fn try_numeric_sequence(prefix: &str, inner: &str, suffix: &str) -> Option<Vec<String>> {
    let parts: Vec<&str> = inner.split("..").collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }

    let start: i64 = parts[0].parse().ok()?;
    let end: i64 = parts[1].parse().ok()?;
    let step: i64 = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else if start <= end {
        1
    } else {
        -1
    };

    if step == 0 {
        return None;
    }

    let mut results = Vec::new();
    let mut i = start;
    loop {
        if step > 0 && i > end {
            break;
        }
        if step < 0 && i < end {
            break;
        }
        let combined = format!("{prefix}{i}{suffix}");
        results.extend(expand(&combined));
        i += step;
    }

    if results.is_empty() {
        None
    } else {
        Some(results)
    }
}

fn try_char_sequence(prefix: &str, inner: &str, suffix: &str) -> Option<Vec<String>> {
    let parts: Vec<&str> = inner.split("..").collect();
    if parts.len() != 2 || parts[0].len() != 1 || parts[1].len() != 1 {
        return None;
    }

    let start = parts[0].as_bytes()[0];
    let end = parts[1].as_bytes()[0];

    if !start.is_ascii_alphabetic() || !end.is_ascii_alphabetic() {
        return None;
    }

    let step: i8 = if start <= end { 1 } else { -1 };
    let mut results = Vec::new();
    let mut ch = start as i16;

    loop {
        if step > 0 && ch > end as i16 {
            break;
        }
        if step < 0 && ch < end as i16 {
            break;
        }
        let combined = format!("{prefix}{}{suffix}", ch as u8 as char);
        results.extend(expand(&combined));
        ch += step as i16;
    }

    Some(results)
}

fn split_alternatives(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0;
    let mut current = String::new();
    let mut escaped = false;

    for ch in s.chars() {
        if escaped {
            current.push('\\');
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        match ch {
            '{' => {
                depth += 1;
                current.push(ch);
            }
            '}' => {
                depth -= 1;
                current.push(ch);
            }
            ',' if depth == 0 => {
                parts.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    parts.push(current);
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comma_alternatives() {
        assert_eq!(expand("{a,b,c}"), vec!["a", "b", "c"]);
    }

    #[test]
    fn test_with_prefix_suffix() {
        assert_eq!(expand("file.{txt,md}"), vec!["file.txt", "file.md"]);
    }

    #[test]
    fn test_numeric_sequence() {
        assert_eq!(expand("{1..5}"), vec!["1", "2", "3", "4", "5"]);
    }

    #[test]
    fn test_char_sequence() {
        assert_eq!(expand("{a..d}"), vec!["a", "b", "c", "d"]);
    }

    #[test]
    fn test_no_braces() {
        assert_eq!(expand("hello"), vec!["hello"]);
    }
}
