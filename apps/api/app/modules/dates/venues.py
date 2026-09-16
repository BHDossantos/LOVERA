"""Public venue shortlist seed. Coordinates are restricted and never serialized to members."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.dates import Venue

SEED = [
    ("rome", "Caffè Letterario", "Ostiense", "rome:eur", ["coffee", "culture"], "€", {"step_free": True, "accessible_toilet": True}, "Bookshop café, bright and busy in the afternoon", 41.8676, 12.4830),
    ("rome", "Sciascia Caffè 1919", "Prati", "rome:prati", ["coffee"], "€", {"step_free": True, "accessible_toilet": False}, "Classic bar, calm mid-afternoon", 41.9081, 12.4640),
    ("rome", "Villa Borghese lakeside walk", "Parioli / Flaminio", "rome:parioli", ["walk"], "free", {"step_free": True, "accessible_toilet": True}, "Daylight park walk with cafés nearby", 41.9137, 12.4880),
    ("rome", "Enoteca Il Goccetto", "Centro Storico", "rome:centro", ["drinks"], "€€", {"step_free": False, "accessible_toilet": False}, "Small wine bar, early evening is quieter", 41.8969, 12.4700),
    ("rome", "Freni e Frizioni", "Trastevere", "rome:trastevere", ["drinks"], "€€", {"step_free": True, "accessible_toilet": False}, "Lively aperitivo bar on a public square", 41.8905, 12.4700),
    ("rome", "Mercato Centrale Roma", "Monti / Esquilino", "rome:monti", ["coffee", "dinner", "activity"], "€€", {"step_free": True, "accessible_toilet": True}, "Busy food hall inside Termini, very public", 41.9009, 12.5018),
    ("rome", "MAXXI museum café", "Parioli / Flaminio", "rome:parioli", ["culture", "coffee"], "€€", {"step_free": True, "accessible_toilet": True}, "Museum café, daytime, easy to leave", 41.9289, 12.4666),
    ("rome", "Trattoria Da Enzo al 29 (early seating)", "Trastevere", "rome:trastevere", ["dinner"], "€€", {"step_free": False, "accessible_toilet": False}, "Well-known trattoria, book early seating", 41.8877, 12.4770),
    ("rome", "Appia Antica bike café", "San Giovanni / Appio", "rome:san-giovanni", ["activity", "walk"], "€", {"step_free": True, "accessible_toilet": True}, "Sunday cycling and coffee on a car-free road", 41.8560, 12.5150),
    ("rome", "Necci dal 1924", "Pigneto / San Lorenzo", "rome:pigneto", ["coffee", "drinks", "dinner"], "€€", {"step_free": True, "accessible_toilet": True}, "Garden café, families and friends around", 41.8885, 12.5290),
    ("rome", "Caffè Ciampini", "Centro Storico", "rome:centro", ["coffee"], "€€", {"step_free": True, "accessible_toilet": False}, "Piazza terrace, daylight", 41.9052, 12.4785),
    ("rome", "Terme di Caracalla evening walk", "San Giovanni / Appio", "rome:san-giovanni", ["walk", "culture"], "free", {"step_free": True, "accessible_toilet": False}, "Open public gardens, well lit at dusk", 41.8790, 12.4930),
    ("barcelona", "Federal Café", "Sant Antoni", "barcelona:eixample", ["coffee"], "€€", {"step_free": True, "accessible_toilet": True}, "Busy brunch café with a rooftop terrace", 41.3775, 2.1630),
    ("barcelona", "Parc de la Ciutadella walk", "Ciutat Vella", "barcelona:gotic", ["walk"], "free", {"step_free": True, "accessible_toilet": True}, "Daylight park walk near the lake", 41.3880, 2.1870),
    ("barcelona", "Bar Calders", "Sant Antoni", "barcelona:eixample", ["drinks"], "€€", {"step_free": True, "accessible_toilet": False}, "Vermouth bar on a pedestrian street", 41.3765, 2.1615),
    ("barcelona", "Mercat de Sant Antoni tapas", "Sant Antoni", "barcelona:eixample", ["dinner", "activity"], "€€", {"step_free": True, "accessible_toilet": True}, "Market hall, very public", 41.3785, 2.1620),
    ("barcelona", "Café de la Pedrera", "Eixample", "barcelona:eixample", ["coffee", "culture"], "€€", {"step_free": True, "accessible_toilet": True}, "Café inside a landmark, daytime", 41.3953, 2.1619),
    ("barcelona", "La Vermuteria del Tano", "Gràcia", "barcelona:gracia", ["drinks"], "€", {"step_free": False, "accessible_toilet": False}, "Old vermouth bar, early evening", 41.4040, 2.1560),
    ("barcelona", "Palo Alto Market café", "Poblenou", "barcelona:poblenou", ["coffee", "activity"], "€€", {"step_free": True, "accessible_toilet": True}, "Weekend market in a garden factory", 41.4066, 2.2050),
    ("barcelona", "Bunkers del Carmel sunset walk", "Horta / Guinardó", "barcelona:horta", ["walk"], "free", {"step_free": False, "accessible_toilet": False}, "Popular viewpoint, busy at sunset", 41.4194, 2.1616),
]


def seed_venues(db: Session) -> int:
    if db.execute(select(Venue.id).limit(1)).first():
        return 0
    for market, name, area, zone, cats, price, access, atmosphere, lat, lon in SEED:
        db.add(Venue(market_id=market, name=name, coarse_area=area, zone_id=zone, categories=cats, price_band=price, accessibility=access, safety_attributes={"public": True, "staffed": True, "well_lit": True}, atmosphere=atmosphere, lat=lat, lon=lon, public_place=True))
    return len(SEED)


def venue_payload(v: Venue) -> dict:
    return {"id": v.id, "name": v.name, "coarse_area": v.coarse_area, "categories": v.categories, "price_band": v.price_band, "accessibility": v.accessibility, "atmosphere": v.atmosphere, "public_place": v.public_place}
