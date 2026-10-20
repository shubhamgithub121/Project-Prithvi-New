"""Predefined chips. A flow with `reply` is answered without the model;
a flow with `prompt` is sent to the model as if the user typed it."""
from typing import Any

from pickups import RATE_PER_KG
from chatbot.tools import TIME_SLOT_LABELS, TIERS

_SLOTS = ", ".join(TIME_SLOT_LABELS.values())
_TIERS = " → ".join(f"{name} ({kg} kg)" for name, kg in TIERS)

FLOWS: dict[str, dict[str, Any]] = {
    "schedule": {
        "label": "Schedule a pickup",
        "primary": True,
        "reply": (
            "Booking takes 3 quick steps:\n"
            "1. **Address**: find it on the map, with city and 6-digit pincode\n"
            f"2. **Date and slot**: {_SLOTS}\n"
            f"3. **Details**: plastic type and rough weight (min 0.5 kg). You'll see your estimate at ₹{RATE_PER_KG}/kg\n\n"
            "[Open Schedule Pickup](/schedule-pickup)"
        ),
    },
    "track": {"label": "Track my pickup", "primary": True, "prompt": "Show my pickups and their status."},
    "earnings": {
        "label": "How much will I earn?",
        "primary": True,
        "reply": (
            f"You earn **₹{RATE_PER_KG} per kg** of plastic (minimum 0.5 kg per pickup). "
            "Tell me roughly how many kg you have and I'll work it out."
        ),
    },
    "plastics": {
        "label": "What plastic do you accept?",
        "primary": True,
        "reply": (
            "We collect:\n"
            "- **PET**: drink and water bottles\n"
            "- **HDPE**: milk, shampoo and detergent containers\n"
            "- **LDPE**: plastic bags and films\n"
            "- **PP**: packaging, tubs and caps\n"
            "- **Mixed** if you're not sure\n\n"
            "Please rinse and dry everything and keep it separate from food or wet waste."
        ),
    },
    "cancel": {"label": "Cancel a pickup", "primary": True, "prompt": "I want to cancel a pickup."},
    "rewards": {
        "label": "Rewards and eco tiers",
        "primary": True,
        "prompt": "Explain the eco tiers and rewards, and show my progress if I'm signed in.",
    },
    "shop": {
        "label": "Eco Shop",
        "primary": False,
        "reply": (
            "Recycled products you can redeem with your Eco Wallet:\n"
            "- Recycled Plastic Planter: ₹299\n"
            "- Reusable Cloth Bag: ₹149\n"
            "- Eco Water Bottle: ₹399\n"
            "- Recycled Notebook: ₹199\n\n"
            "[Visit the Eco Shop](/shop)"
        ),
    },
    "about": {
        "label": "About Prithvi",
        "primary": False,
        "reply": (
            "Prithvi (formerly Plastic Revive) collects segregated plastic from your doorstep and sends it to "
            "certified recyclers. We've diverted more than 40,000 kg of plastic so far, working toward zero "
            f"waste going to landfill. Eco tiers: {_TIERS}.\n\n[Read more](/about)"
        ),
    },
    "human": {
        "label": "Talk to a human",
        "primary": False,
        "reply": (
            "You can reach the Prithvi team directly:\n"
            "- Email: sgoswami6420@gmail.com\n"
            "- Phone: +91 8800948828"
        ),
    },
}


def public_flows() -> list[dict[str, Any]]:
    return [{"id": k, "label": v["label"], "primary": v["primary"]} for k, v in FLOWS.items()]
