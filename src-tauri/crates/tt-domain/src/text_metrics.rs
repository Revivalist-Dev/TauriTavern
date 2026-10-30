use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMetrics {
    pub chars: usize,
    pub words: usize,
}

impl TextMetrics {
    pub fn from_text(text: &str) -> Self {
        let mut chars = 0_usize;
        let mut words = 0_usize;
        let mut in_word = false;

        for character in text.chars() {
            chars += 1;
            if character.is_alphanumeric() {
                if !in_word {
                    words += 1;
                    in_word = true;
                }
            } else {
                in_word = false;
            }
        }

        Self { chars, words }
    }
}

#[cfg(test)]
mod tests {
    use super::TextMetrics;

    #[test]
    fn counts_latin_words_and_punctuation() {
        assert_eq!(
            TextMetrics::from_text("Hello, world! Fine."),
            TextMetrics {
                chars: 19,
                words: 3
            }
        );
    }
}
