from backend.app.features.research.search.crawl import _is_safe_url


def test_is_safe_url_blocks_loopback():
    assert _is_safe_url("http://127.0.0.1/") is False
    assert _is_safe_url("http://localhost/") is False


def test_is_safe_url_blocks_private_ranges():
    assert _is_safe_url("http://10.0.0.5/") is False
    assert _is_safe_url("http://192.168.1.1/") is False
    assert _is_safe_url("http://172.16.0.1/") is False


def test_is_safe_url_blocks_cloud_metadata_endpoint():
    assert _is_safe_url("http://169.254.169.254/latest/meta-data/") is False


def test_is_safe_url_blocks_non_http_scheme():
    assert _is_safe_url("file:///etc/passwd") is False
    assert _is_safe_url("ftp://example.com/") is False


def test_is_safe_url_allows_public_ip_literal():
    assert _is_safe_url("http://93.184.216.34/") is True


def test_is_safe_url_rejects_malformed_url():
    assert _is_safe_url("not a url") is False
    assert _is_safe_url("") is False
