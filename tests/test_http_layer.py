from __future__ import annotations

import build_ward_reco_runtime as builder
import pytest
import requests


class FakeResponse:
    def __init__(self, *, status_code: int = 200, payload=None, headers=None) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"http {self.status_code}")


@pytest.fixture(autouse=True)
def no_throttling_and_no_sleeping(monkeypatch):
    monkeypatch.setattr(builder, "REQUEST_THROTTLER", None)
    monkeypatch.setattr(builder.time, "sleep", lambda _seconds: None)
    monkeypatch.delenv("OPENDOTA_API_KEY", raising=False)


@pytest.fixture
def http_calls(monkeypatch):
    """Records outgoing requests and replays a queued list of responses."""
    calls: list[dict] = []
    queue: list = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append({"url": url, "params": params, "timeout": timeout})
        outcome = queue.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(builder.requests, "get", fake_get)
    return calls, queue


class TestRequestJson:
    def test_returns_payload_on_first_success(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(payload={"rows": [1]}))
        assert builder.request_json("http://x/api", timeout=1.0, retries=3) == {"rows": [1]}
        assert len(calls) == 1
        assert calls[0]["timeout"] == 1.0

    def test_params_are_passed_through(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(payload={}))
        builder.request_json("http://x", params={"sql": "SELECT 1"}, timeout=1.0, retries=1)
        assert calls[0]["params"] == {"sql": "SELECT 1"}

    def test_no_params_are_sent_as_none(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(payload={}))
        builder.request_json("http://x", timeout=1.0, retries=1)
        assert calls[0]["params"] is None

    def test_rate_limit_is_retried(self, http_calls):
        calls, queue = http_calls
        queue.extend(
            [
                FakeResponse(status_code=429, headers={"Retry-After": "1"}),
                FakeResponse(payload={"ok": True}),
            ]
        )
        assert builder.request_json("http://x", timeout=1.0, retries=3) == {"ok": True}
        assert len(calls) == 2

    def test_server_error_is_retried(self, http_calls):
        calls, queue = http_calls
        queue.extend([FakeResponse(status_code=503), FakeResponse(payload={"ok": True})])
        assert builder.request_json("http://x", timeout=1.0, retries=3) == {"ok": True}
        assert len(calls) == 2

    def test_transport_error_is_retried(self, http_calls):
        calls, queue = http_calls
        queue.extend([requests.ConnectionError("boom"), FakeResponse(payload={"ok": True})])
        assert builder.request_json("http://x", timeout=1.0, retries=3) == {"ok": True}
        assert len(calls) == 2

    def test_client_error_is_not_retried(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(status_code=404))
        with pytest.raises(requests.HTTPError):
            builder.request_json("http://x", timeout=1.0, retries=3)
        assert len(calls) == 1

    def test_retries_are_exhausted_and_raise(self, http_calls):
        calls, queue = http_calls
        queue.extend([FakeResponse(status_code=500), FakeResponse(status_code=500)])
        with pytest.raises(requests.HTTPError):
            builder.request_json("http://x", timeout=1.0, retries=2)
        assert len(calls) == 2

    def test_transport_error_on_last_attempt_propagates(self, http_calls):
        _calls, queue = http_calls
        queue.append(requests.ConnectionError("boom"))
        with pytest.raises(requests.ConnectionError):
            builder.request_json("http://x", timeout=1.0, retries=1)

    def test_retries_below_one_still_make_one_attempt(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(payload={"ok": True}))
        assert builder.request_json("http://x", timeout=1.0, retries=0) == {"ok": True}
        assert len(calls) == 1

    def test_requests_go_through_the_throttler_when_configured(self, http_calls, monkeypatch):
        _calls, queue = http_calls
        queue.append(FakeResponse(payload={"ok": True}))
        throttler = builder.RequestThrottler(0.0)
        monkeypatch.setattr(builder, "REQUEST_THROTTLER", throttler)
        assert builder.request_json("http://x", timeout=1.0, retries=1) == {"ok": True}


class TestRequestThrottler:
    def test_negative_delay_is_clamped_to_zero(self):
        assert builder.RequestThrottler(-5.0).delay_sec == 0.0

    def test_action_result_is_returned(self):
        response = FakeResponse(payload={"ok": True})
        assert builder.RequestThrottler(0.0).run(lambda: response) is response

    def test_second_call_waits_for_the_delay(self, monkeypatch):
        sleeps: list[float] = []
        clock = {"now": 0.0}
        monkeypatch.setattr(builder.time, "monotonic", lambda: clock["now"])
        monkeypatch.setattr(builder.time, "sleep", lambda seconds: sleeps.append(seconds))
        throttler = builder.RequestThrottler(2.0)
        throttler.run(lambda: FakeResponse())
        throttler.run(lambda: FakeResponse())
        assert sleeps == [2.0]

    def test_next_slot_is_scheduled_even_when_the_action_raises(self, monkeypatch):
        clock = {"now": 0.0}
        monkeypatch.setattr(builder.time, "monotonic", lambda: clock["now"])
        monkeypatch.setattr(builder.time, "sleep", lambda _seconds: None)
        throttler = builder.RequestThrottler(3.0)
        with pytest.raises(requests.ConnectionError):
            throttler.run(lambda: (_ for _ in ()).throw(requests.ConnectionError("boom")))
        assert throttler._next_allowed_at == pytest.approx(3.0)


class TestFetchRecentMatchIds:
    def test_parses_rows_and_filters_unparsed_matches(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(payload={"rows": [{"match_id": 2}, {"match_id": "3"}]}))
        assert builder.fetch_recent_match_ids(10, 0, 1.0, 1) == [2, 3]
        sql = calls[0]["params"]["sql"]
        assert "version IS NOT NULL" in sql
        assert "LIMIT 10 OFFSET 0" in sql

    def test_limit_and_offset_are_clamped(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(payload={"rows": []}))
        builder.fetch_recent_match_ids(0, -5, 1.0, 1)
        assert "LIMIT 1 OFFSET 0" in calls[0]["params"]["sql"]

    def test_malformed_rows_are_skipped(self, http_calls):
        _calls, queue = http_calls
        queue.append(
            FakeResponse(
                payload={"rows": ["nope", {"other": 1}, {"match_id": "abc"}, {"match_id": 9}]}
            )
        )
        assert builder.fetch_recent_match_ids(10, 0, 1.0, 1) == [9]

    def test_unexpected_payload_yields_no_ids(self, http_calls):
        _calls, queue = http_calls
        queue.extend([FakeResponse(payload=["nope"]), FakeResponse(payload={"rows": "x"})])
        assert builder.fetch_recent_match_ids(10, 0, 1.0, 1) == []
        assert builder.fetch_recent_match_ids(10, 0, 1.0, 1) == []


class TestCollectRecentUncachedMatchIds:
    @pytest.fixture
    def fake_batches(self, monkeypatch):
        batches: list[list[int]] = []
        requested: list[tuple[int, int]] = []

        def fake_fetch(limit, offset, timeout, retries):
            requested.append((limit, offset))
            return batches.pop(0) if batches else []

        monkeypatch.setattr(builder, "fetch_recent_match_ids", fake_fetch)
        return batches, requested

    def test_returns_only_uncached_ids(self, fake_batches):
        batches, _requested = fake_batches
        batches.append([1, 2, 3, 4])
        fresh, scanned = builder.collect_recent_uncached_match_ids(
            2, cached_match_ids={1, 2}, timeout=1.0, retries=1
        )
        assert fresh == [3, 4]
        assert scanned == 4

    def test_pages_until_the_target_is_reached(self, fake_batches):
        batches, requested = fake_batches
        batches.extend([[1, 2, 3, 4], [5, 6, 7, 8]])
        fresh, scanned = builder.collect_recent_uncached_match_ids(
            4, cached_match_ids={1, 2}, timeout=1.0, retries=1
        )
        assert fresh == [3, 4, 5, 6]
        assert scanned == 8
        assert requested == [(4, 0), (4, 4)]

    def test_stops_on_an_empty_page(self, fake_batches):
        batches, _requested = fake_batches
        batches.extend([[1, 2], []])
        fresh, scanned = builder.collect_recent_uncached_match_ids(
            10, cached_match_ids=set(), timeout=1.0, retries=1
        )
        assert fresh == [1, 2]
        assert scanned == 2

    def test_stops_on_a_short_page(self, fake_batches):
        batches, requested = fake_batches
        batches.append([1])
        fresh, _scanned = builder.collect_recent_uncached_match_ids(
            5, cached_match_ids=set(), timeout=1.0, retries=1
        )
        assert fresh == [1]
        assert len(requested) == 1

    def test_duplicate_ids_across_pages_are_ignored(self, fake_batches):
        batches, _requested = fake_batches
        batches.extend([[1, 1, 2], [2, 3]])
        fresh, scanned = builder.collect_recent_uncached_match_ids(
            3, cached_match_ids=set(), timeout=1.0, retries=1
        )
        assert fresh == [1, 2, 3]
        assert scanned == 5

    def test_batch_size_is_capped_by_the_api_batch_limit(self, fake_batches):
        batches, requested = fake_batches
        batches.append([])
        builder.collect_recent_uncached_match_ids(
            builder.DEFAULT_RECENT_MATCH_BATCH_SIZE + 500,
            cached_match_ids=set(),
            timeout=1.0,
            retries=1,
        )
        assert requested[0][0] == builder.DEFAULT_RECENT_MATCH_BATCH_SIZE

    def test_non_positive_target_still_asks_for_one_match(self, fake_batches):
        batches, requested = fake_batches
        batches.append([7])
        fresh, _scanned = builder.collect_recent_uncached_match_ids(
            0, cached_match_ids=set(), timeout=1.0, retries=1
        )
        assert fresh == [7]
        assert requested == [(1, 0)]


class TestFetchMatchPayload:
    def test_returns_payload_dict(self, http_calls):
        calls, queue = http_calls
        queue.append(FakeResponse(payload={"players": []}))
        assert builder.fetch_match_payload(555, 1.0, 1) == (555, {"players": []})
        assert calls[0]["url"].endswith("/matches/555")

    def test_non_dict_payload_is_rejected(self, http_calls):
        _calls, queue = http_calls
        queue.append(FakeResponse(payload=["nope"]))
        assert builder.fetch_match_payload(555, 1.0, 1) == (555, None)

    def test_request_exception_is_swallowed(self, http_calls):
        _calls, queue = http_calls
        queue.append(requests.ConnectionError("boom"))
        assert builder.fetch_match_payload(555, 1.0, 1) == (555, None)

    def test_runtime_error_is_swallowed(self, monkeypatch):
        def raise_runtime(*_args, **_kwargs):
            raise RuntimeError("no json after retries")

        monkeypatch.setattr(builder, "request_json", raise_runtime)
        assert builder.fetch_match_payload(555, 1.0, 1) == (555, None)
