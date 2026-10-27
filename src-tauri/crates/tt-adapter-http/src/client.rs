use reqwest::{Client, ClientBuilder, Error};

pub(crate) fn build_http_client(
    builder: ClientBuilder,
    product_user_agent: &str,
) -> Result<Client, Error> {
    builder.user_agent(product_user_agent).build()
}

pub(crate) fn configure_blocking_http_client(
    builder: reqwest::blocking::ClientBuilder,
    product_user_agent: &str,
) -> reqwest::blocking::ClientBuilder {
    builder.user_agent(product_user_agent)
}
