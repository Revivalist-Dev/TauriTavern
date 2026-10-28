//! Script toolbox embedded at compile time and exposed through `@tauritavern/kit/*`.

pub(crate) const MODULES: &[(&str, &str)] = &[
    (
        "@tauritavern/kit/dayjs",
        include_str!("../resources/vendor/dayjs.js"),
    ),
    (
        "@tauritavern/kit/es-toolkit",
        include_str!("../resources/vendor/es-toolkit.js"),
    ),
    (
        "@tauritavern/kit/fast-xml-parser",
        include_str!("../resources/vendor/fast-xml-parser.js"),
    ),
    (
        "@tauritavern/kit/marked",
        include_str!("../resources/vendor/marked.js"),
    ),
    (
        "@tauritavern/kit/papaparse",
        include_str!("../resources/vendor/papaparse.js"),
    ),
    (
        "@tauritavern/kit/slugify",
        include_str!("../resources/vendor/slugify.js"),
    ),
];
