import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from server import app
from auth import get_current_user

VALID_BODY = {
    "address": "221B Baker Street",
    "city": "Delhi",
    "pincode": "110001",
    "lat": 28.6139,
    "lng": 77.2090,
    "pickup_date": "2099-01-01",
    "time_slot": "8-12",
    "plastic_type": "pet",
    "estimated_weight_kg": 5,
}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def override_get_current_user():
    def _override(user_id="u1"):
        mock_user = MagicMock()
        mock_user.id = user_id
        app.dependency_overrides[get_current_user] = lambda: mock_user
        return mock_user

    yield _override
    app.dependency_overrides.clear()


class TestCreatePickup:
    def test_requires_auth(self, client, mock_supabase):
        resp = client.post("/api/pickups/", json=VALID_BODY)
        assert resp.status_code in (401, 422)

    def test_success_computes_earnings_server_side(self, client, mock_supabase, override_get_current_user):
        override_get_current_user(user_id="u1")

        with patch("pickups.tracking.start_tracking") as mock_start:
            resp = client.post("/api/pickups/", json=VALID_BODY)

        assert resp.status_code == 200
        body = resp.json()
        assert body["user_id"] == "u1"
        assert body["estimated_earnings"] == 75  # 5kg * RATE_PER_KG(15), not client supplied
        assert body["status"] == "scheduled"
        assert body["rider_id"].startswith("dummy-")
        mock_start.assert_called_once_with(body["rider_id"])
        mock_supabase.table.assert_any_call("pickups")

    def test_ignores_client_supplied_earnings_and_rider_id(self, client, mock_supabase, override_get_current_user):
        override_get_current_user(user_id="u1")
        tampered = {**VALID_BODY, "estimated_earnings": 999999, "rider_id": "attacker-controlled", "user_id": "someone-else"}

        with patch("pickups.tracking.start_tracking"):
            resp = client.post("/api/pickups/", json=tampered)

        assert resp.status_code == 200
        body = resp.json()
        assert body["estimated_earnings"] == 75
        assert body["rider_id"] != "attacker-controlled"
        assert body["user_id"] == "u1"

    @pytest.mark.parametrize("field,value", [
        ("pincode", "abc"),
        ("pincode", "123"),
        ("time_slot", "midnight"),
        ("estimated_weight_kg", 0.1),
        ("pickup_date", "2000-01-01"),
    ])
    def test_rejects_invalid_input(self, client, mock_supabase, override_get_current_user, field, value):
        override_get_current_user()
        bad_body = {**VALID_BODY, field: value}
        resp = client.post("/api/pickups/", json=bad_body)
        assert resp.status_code == 422


class TestListMyPickups:
    def test_scopes_to_current_user(self, client, mock_supabase, override_get_current_user):
        override_get_current_user(user_id="u1")
        rows = [{"id": "p1", "user_id": "u1"}]
        chain = (
            mock_supabase.table.return_value
            .select.return_value
            .eq.return_value
            .order.return_value
        )
        chain.execute.return_value = MagicMock(data=rows)

        resp = client.get("/api/pickups/me")

        assert resp.status_code == 200
        assert resp.json() == rows
        mock_supabase.table.return_value.select.return_value.eq.assert_called_once_with("user_id", "u1")


class TestPickupOwnership:
    def _mock_pickup_row(self, mock_supabase, owner_id, rider_id="dummy-abc123"):
        row = {"id": "p1", "user_id": owner_id, "rider_id": rider_id, "status": "scheduled"}
        chain = mock_supabase.table.return_value.select.return_value.eq.return_value
        chain.execute.return_value = MagicMock(data=[row])
        return row

    def test_location_404_for_non_owner(self, client, mock_supabase, override_get_current_user):
        self._mock_pickup_row(mock_supabase, owner_id="someone-else")
        override_get_current_user(user_id="attacker")

        resp = client.get("/api/pickups/p1/location")

        assert resp.status_code == 404

    def test_location_success_for_owner(self, client, mock_supabase, override_get_current_user):
        self._mock_pickup_row(mock_supabase, owner_id="u1", rider_id="dummy-abc123")
        override_get_current_user(user_id="u1")

        with patch("pickups.tracking.get_latest_location", return_value={"lat": 1.0, "lng": 2.0}) as mock_loc:
            resp = client.get("/api/pickups/p1/location")

        assert resp.status_code == 200
        assert resp.json() == {"lat": 1.0, "lng": 2.0}
        mock_loc.assert_called_once_with("dummy-abc123")

    def test_cancel_404_for_non_owner(self, client, mock_supabase, override_get_current_user):
        self._mock_pickup_row(mock_supabase, owner_id="someone-else")
        override_get_current_user(user_id="attacker")

        with patch("pickups.tracking.stop_tracking") as mock_stop:
            resp = client.post("/api/pickups/p1/cancel")

        assert resp.status_code == 404
        mock_stop.assert_not_called()

    def test_cancel_success_for_owner(self, client, mock_supabase, override_get_current_user):
        self._mock_pickup_row(mock_supabase, owner_id="u1", rider_id="dummy-abc123")
        override_get_current_user(user_id="u1")

        with patch("pickups.tracking.stop_tracking") as mock_stop:
            resp = client.post("/api/pickups/p1/cancel")

        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"
        mock_stop.assert_called_once_with("dummy-abc123")
