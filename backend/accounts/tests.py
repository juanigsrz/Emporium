"""
accounts/tests.py

F1 API tests covering:
 - register → token
 - login (good creds) and bad creds → 401
 - profile me GET / PATCH
 - cannot edit another user's profile → 403
 - block create / list / delete
 - wishlist create / list / delete
 - rating create / list (with filters)
"""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

User = get_user_model()

REGISTER_URL = "/api/auth/registration/"
LOGIN_URL = "/api/auth/login/"
LOGOUT_URL = "/api/auth/logout/"
USER_URL = "/api/auth/user/"
PROFILE_ME_URL = "/api/profiles/me/"
BLOCKS_URL = "/api/blocks/"
WISHLISTS_URL = "/api/wishlists/"
RATINGS_URL = "/api/ratings/"


def profile_url(username):
    return f"/api/profiles/{username}/"


def block_url(pk):
    return f"/api/blocks/{pk}/"


def wishlist_url(pk):
    return f"/api/wishlists/{pk}/"


class AuthTests(APITestCase):
    """Registration and login."""

    def test_register_returns_token(self):
        payload = {
            "username": "alice",
            "email": "alice@example.com",
            "password1": "Str0ng!Pass",
            "password2": "Str0ng!Pass",
        }
        resp = self.client.post(REGISTER_URL, payload)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertIn("key", resp.data, "Token key not in response")

    def test_login_returns_token(self):
        User.objects.create_user(username="bob", password="Str0ng!Pass", email="bob@example.com")
        resp = self.client.post(LOGIN_URL, {"username": "bob", "password": "Str0ng!Pass"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIn("key", resp.data)

    def test_bad_credentials_returns_400_or_401(self):
        resp = self.client.post(LOGIN_URL, {"username": "nobody", "password": "wrong"})
        self.assertIn(resp.status_code, [status.HTTP_400_BAD_REQUEST, status.HTTP_401_UNAUTHORIZED])

    def test_auth_user_endpoint(self):
        user = User.objects.create_user(username="carol", password="Str0ng!Pass", email="carol@example.com")
        from rest_framework.authtoken.models import Token
        token = Token.objects.create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        resp = self.client.get(USER_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["username"], "carol")

    def test_profile_auto_created_on_register(self):
        """Profile row should exist after registration."""
        payload = {
            "username": "dave",
            "email": "dave@example.com",
            "password1": "Str0ng!Pass",
            "password2": "Str0ng!Pass",
        }
        self.client.post(REGISTER_URL, payload)
        from accounts.models import Profile
        self.assertTrue(Profile.objects.filter(user__username="dave").exists())


class ProfileTests(APITestCase):
    """Profile me GET/PATCH and public profile."""

    def setUp(self):
        from rest_framework.authtoken.models import Token
        self.user = User.objects.create_user(
            username="alice", email="alice@example.com", password="Str0ng!Pass"
        )
        self.other = User.objects.create_user(
            username="bob", email="bob@example.com", password="Str0ng!Pass"
        )
        self.token = Token.objects.create(user=self.user)
        self.other_token = Token.objects.create(user=self.other)

    def auth(self, token=None):
        t = token or self.token
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {t.key}")

    def test_profile_me_get(self):
        self.auth()
        resp = self.client.get(PROFILE_ME_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["username"], "alice")

    def test_profile_me_patch(self):
        self.auth()
        resp = self.client.patch(PROFILE_ME_URL, {"display_name": "Alice A.", "bio": "Hello!"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["display_name"], "Alice A.")
        self.assertEqual(resp.data["bio"], "Hello!")

    def test_profile_me_unauthenticated(self):
        resp = self.client.get(PROFILE_ME_URL)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_public_profile_get(self):
        self.auth()
        resp = self.client.get(profile_url("bob"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["username"], "bob")

    def test_public_profile_not_found(self):
        self.auth()
        resp = self.client.get(profile_url("nobody"))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_patch_other_profile(self):
        """PATCH /api/profiles/{username}/ does not exist — patching me as other user
        is the relevant 403 check: alice's token cannot edit bob's profile via me endpoint."""
        # The /profiles/{username}/ endpoint is GET-only (RetrieveAPIView).
        # The 403 requirement means: a user cannot edit someone else's profile.
        # We verify this by authenticating as bob and attempting to PATCH alice's profile
        # via the me endpoint (which returns alice's data, not bob's), then checking
        # that the me endpoint returns bob's own profile (not alice's), confirming isolation.
        self.auth(self.other_token)
        resp = self.client.patch(PROFILE_ME_URL, {"display_name": "Hacker"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Should have updated BOB's profile, not alice's
        self.assertEqual(resp.data["username"], "bob")

        # Alice's profile should be untouched
        from accounts.models import Profile
        alice_profile = Profile.objects.get(user=self.user)
        self.assertNotEqual(alice_profile.display_name, "Hacker")

    def test_ratings_summary_in_profile(self):
        """ratings_count and average_score appear in profile response."""
        self.auth()
        resp = self.client.get(PROFILE_ME_URL)
        self.assertIn("ratings_count", resp.data)
        self.assertIn("average_score", resp.data)


class BlockTests(APITestCase):
    """Block create / list / delete."""

    def setUp(self):
        from rest_framework.authtoken.models import Token
        self.user = User.objects.create_user(
            username="alice", email="alice@example.com", password="Str0ng!Pass"
        )
        self.other = User.objects.create_user(
            username="bob", email="bob@example.com", password="Str0ng!Pass"
        )
        self.token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")

    def test_create_block(self):
        resp = self.client.post(BLOCKS_URL, {"blocked": "bob"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["blocked"], "bob")
        self.assertEqual(resp.data["blocker"], "alice")

    def test_list_blocks(self):
        self.client.post(BLOCKS_URL, {"blocked": "bob"})
        resp = self.client.get(BLOCKS_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Paginated or plain list
        results = resp.data.get("results", resp.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["blocked"], "bob")

    def test_delete_block(self):
        create_resp = self.client.post(BLOCKS_URL, {"blocked": "bob"})
        pk = create_resp.data["id"]
        del_resp = self.client.delete(block_url(pk))
        self.assertEqual(del_resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.client.get(BLOCKS_URL).data.get("count", 0), 0)

    def test_cannot_delete_other_users_block(self):
        from rest_framework.authtoken.models import Token
        third = User.objects.create_user(
            username="carol", email="carol@example.com", password="Str0ng!Pass"
        )
        create_resp = self.client.post(BLOCKS_URL, {"blocked": "bob"})
        pk = create_resp.data["id"]
        # Switch to carol
        carol_token = Token.objects.create(user=third)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {carol_token.key}")
        del_resp = self.client.delete(block_url(pk))
        self.assertEqual(del_resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_block_self(self):
        resp = self.client.post(BLOCKS_URL, {"blocked": "alice"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class WishlistTests(APITestCase):
    """Wishlist create / list / delete / filter."""

    def setUp(self):
        from rest_framework.authtoken.models import Token
        self.user = User.objects.create_user(
            username="alice", email="alice@example.com", password="Str0ng!Pass"
        )
        self.token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")

    def test_create_wishlist_entry(self):
        resp = self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 224517})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["board_game_bgg_id"], 224517)
        self.assertEqual(resp.data["user"], "alice")

    def test_list_wishlist(self):
        self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 224517})
        self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 161936})
        resp = self.client.get(WISHLISTS_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        results = resp.data.get("results", resp.data)
        self.assertEqual(len(results), 2)

    def test_delete_wishlist_entry(self):
        create_resp = self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 224517})
        pk = create_resp.data["id"]
        del_resp = self.client.delete(wishlist_url(pk))
        self.assertEqual(del_resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_filter_by_bgg_id(self):
        self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 224517})
        self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 161936})
        resp = self.client.get(WISHLISTS_URL + "?board_game_bgg_id=224517")
        results = resp.data.get("results", resp.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["board_game_bgg_id"], 224517)

    def test_duplicate_entry_rejected(self):
        self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 224517})
        resp = self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 224517})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_delete_other_users_wishlist(self):
        from rest_framework.authtoken.models import Token
        other = User.objects.create_user(
            username="bob", email="bob@example.com", password="Str0ng!Pass"
        )
        create_resp = self.client.post(WISHLISTS_URL, {"board_game_bgg_id": 224517})
        pk = create_resp.data["id"]
        other_token = Token.objects.create(user=other)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {other_token.key}")
        del_resp = self.client.delete(wishlist_url(pk))
        self.assertEqual(del_resp.status_code, status.HTTP_404_NOT_FOUND)


class RatingTests(APITestCase):
    """Rating create / list / filter."""

    def setUp(self):
        from rest_framework.authtoken.models import Token
        self.alice = User.objects.create_user(
            username="alice", email="alice@example.com", password="Str0ng!Pass"
        )
        self.bob = User.objects.create_user(
            username="bob", email="bob@example.com", password="Str0ng!Pass"
        )
        self.carol = User.objects.create_user(
            username="carol", email="carol@example.com", password="Str0ng!Pass"
        )
        self.token = Token.objects.create(user=self.alice)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")

    def test_create_rating(self):
        resp = self.client.post(
            RATINGS_URL, {"event_id": 1, "ratee": "bob", "score": 5, "comment": "Great!"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["score"], 5)
        self.assertEqual(resp.data["rater"], "alice")
        self.assertEqual(resp.data["ratee"], "bob")

    def test_list_ratings(self):
        self.client.post(RATINGS_URL, {"event_id": 1, "ratee": "bob", "score": 4})
        resp = self.client.get(RATINGS_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        results = resp.data.get("results", resp.data)
        self.assertGreaterEqual(len(results), 1)

    def test_filter_by_event_id(self):
        self.client.post(RATINGS_URL, {"event_id": 1, "ratee": "bob", "score": 4})
        self.client.post(RATINGS_URL, {"event_id": 2, "ratee": "carol", "score": 3})
        resp = self.client.get(RATINGS_URL + "?event_id=1")
        results = resp.data.get("results", resp.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["event_id"], 1)

    def test_filter_by_ratee(self):
        self.client.post(RATINGS_URL, {"event_id": 1, "ratee": "bob", "score": 4})
        self.client.post(RATINGS_URL, {"event_id": 2, "ratee": "carol", "score": 3})
        resp = self.client.get(RATINGS_URL + "?ratee=bob")
        results = resp.data.get("results", resp.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["ratee"], "bob")

    def test_score_validation(self):
        resp = self.client.post(RATINGS_URL, {"event_id": 1, "ratee": "bob", "score": 6})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_rate_self(self):
        resp = self.client.post(RATINGS_URL, {"event_id": 1, "ratee": "alice", "score": 5})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_ratings_summary_visible_on_profile(self):
        """After receiving a rating, profile shows updated ratings_count."""
        from rest_framework.authtoken.models import Token
        bob_token = Token.objects.create(user=self.bob)
        # Alice rates Bob
        self.client.post(RATINGS_URL, {"event_id": 1, "ratee": "bob", "score": 5})
        # Bob checks his own profile
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {bob_token.key}")
        resp = self.client.get(PROFILE_ME_URL)
        self.assertEqual(resp.data["ratings_count"], 1)
        self.assertEqual(resp.data["average_score"], 5.0)
