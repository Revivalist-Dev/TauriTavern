use std::collections::BTreeMap;

pub struct ParsedDocument {
    pub frontmatter: BTreeMap<String, Vec<String>>,
    pub body: String,
}

pub fn parse_document(text: &str) -> ParsedDocument {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let normalized = text.replace("\r\n", "\n");
    // Keep the original body when no frontmatter is present.
    if !normalized.starts_with("---\n") {
        return ParsedDocument {
            frontmatter: BTreeMap::new(),
            body: text.to_string(),
        };
    }
    let Some(end) = normalized[4..].find("\n---") else {
        return ParsedDocument {
            frontmatter: BTreeMap::new(),
            body: text.to_string(),
        };
    };
    let header_end = 4 + end;
    let header = &normalized[4..header_end];
    let body_start = header_end + 4;
    let body = normalized.get(body_start..).unwrap_or("").to_string();
    ParsedDocument {
        frontmatter: parse_header(header),
        body,
    }
}

fn parse_header(header: &str) -> BTreeMap<String, Vec<String>> {
    let mut values = BTreeMap::<String, Vec<String>>::new();
    let mut current_list: Option<String> = None;
    for raw_line in header.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim_start();
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(key) = current_list.as_ref() {
                values
                    .entry(key.clone())
                    .or_default()
                    .push(unquote(item).to_string());
            }
            continue;
        }
        let Some((key, raw_value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_string();
        if key.is_empty() {
            continue;
        }
        let value = raw_value.trim();
        if value.is_empty() {
            values.entry(key.clone()).or_default();
            current_list = Some(key);
            continue;
        }
        current_list = None;
        let value = value.trim_matches('"').trim_matches('\'').to_string();
        if value.starts_with('[') && value.ends_with(']') {
            let list = value[1..value.len() - 1]
                .split(',')
                .map(|item| unquote(item.trim()).to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>();
            values.insert(key, list);
        } else {
            values.insert(key, vec![value]);
        }
    }
    values
}

fn unquote(value: &str) -> &str {
    value.trim().trim_matches('"').trim_matches('\'').trim()
}

pub fn value<'a>(values: &'a BTreeMap<String, Vec<String>>, key: &str) -> Option<&'a str> {
    values
        .get(key)
        .and_then(|values| values.first())
        .map(String::as_str)
}

pub fn list(values: &BTreeMap<String, Vec<String>>, key: &str) -> Vec<String> {
    values.get(key).cloned().unwrap_or_default()
}

pub fn bool_value(values: &BTreeMap<String, Vec<String>>, key: &str) -> bool {
    value(values, key)
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "true" | "yes" | "1"))
}

pub fn title_from_body(body: &str, fallback: &str) -> String {
    for line in body.lines() {
        let line = line.trim();
        if let Some(title) = line.strip_prefix("# ") {
            if !title.trim().is_empty() {
                return title.trim().to_string();
            }
        }
        if !line.is_empty() {
            break;
        }
    }
    fallback.to_string()
}

pub fn slugify(value: &str) -> String {
    let mut result = String::new();
    let mut previous_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash && !result.is_empty() {
            result.push('-');
            previous_dash = true;
        }
    }
    result.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cursor_frontmatter_and_body() {
        let parsed = parse_document(
            "---\nname: Harbor Notes\ndescription: Tide rules\nglobs: [**/*.md, lore/*]\nalwaysApply: true\n---\n\n# Harbor\nBody",
        );
        assert_eq!(value(&parsed.frontmatter, "name"), Some("Harbor Notes"));
        assert_eq!(
            list(&parsed.frontmatter, "globs"),
            vec!["**/*.md", "lore/*"]
        );
        assert!(bool_value(&parsed.frontmatter, "alwaysApply"));
        assert!(parsed.body.contains("# Harbor"));
    }

    #[test]
    fn leaves_plain_markdown_intact() {
        let parsed = parse_document("# Plain\nNo frontmatter.");
        assert!(parsed.frontmatter.is_empty());
        assert_eq!(parsed.body, "# Plain\nNo frontmatter.");
    }

    #[test]
    fn slugifies_names() {
        assert_eq!(slugify("Harbor Notes!"), "harbor-notes");
    }
}
