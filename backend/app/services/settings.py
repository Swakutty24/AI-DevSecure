import copy

from sqlalchemy.orm import Session

from ..config import DEFAULT_SETTINGS
from ..models import Setting

SECRET_FIELDS = {("integrations", "llm_api_key"), ("integrations", "github_token")}


def get_settings(db: Session) -> dict:
    merged = copy.deepcopy(DEFAULT_SETTINGS)
    for row in db.query(Setting).all():
        if row.key in merged and isinstance(row.value, dict):
            merged[row.key].update(row.value)
    return merged


def update_settings(db: Session, patch: dict) -> dict:
    current = get_settings(db)
    for section, values in patch.items():
        if section not in DEFAULT_SETTINGS or not isinstance(values, dict):
            continue
        for key, value in values.items():
            if key not in DEFAULT_SETTINGS[section]:
                continue
            # Masked secrets coming back from the UI mean "unchanged".
            if (section, key) in SECRET_FIELDS and isinstance(value, str) and "•" in value:
                continue
            current[section][key] = value
        row = db.get(Setting, section)
        if row is None:
            db.add(Setting(key=section, value=current[section]))
        else:
            row.value = dict(current[section])
    db.commit()
    return current


def reset_settings(db: Session) -> dict:
    db.query(Setting).delete()
    db.commit()
    return copy.deepcopy(DEFAULT_SETTINGS)


def mask(value: str) -> str:
    if not value:
        return ""
    return value[:4] + "•" * 16


def public_settings(settings: dict) -> dict:
    out = copy.deepcopy(settings)
    for section, key in SECRET_FIELDS:
        out[section][key] = mask(out[section][key])
    out["integrations"]["llm_connected"] = bool(settings["integrations"]["llm_api_key"])
    out["integrations"]["github_connected"] = bool(settings["integrations"]["github_token"])
    return out
