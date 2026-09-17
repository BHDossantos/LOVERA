"""Coarse geography. Members declare a city and a zone; distance bands come from zone centroids, never raw coordinates."""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Zone:
    id: str
    city_id: str
    name: str
    lat: float
    lon: float


@dataclass(frozen=True)
class City:
    id: str
    name: str
    country: str
    timezone: str
    lat: float
    lon: float


CITIES: dict[str, City] = {
    "rome": City("rome", "Rome", "IT", "Europe/Rome", 41.9028, 12.4964),
    "barcelona": City("barcelona", "Barcelona", "ES", "Europe/Madrid", 41.3874, 2.1686),
}

ZONES: dict[str, Zone] = {
    z.id: z
    for z in [
        Zone("rome:centro", "rome", "Centro Storico", 41.8986, 12.4768),
        Zone("rome:prati", "rome", "Prati", 41.9095, 12.4625),
        Zone("rome:trastevere", "rome", "Trastevere", 41.8890, 12.4692),
        Zone("rome:monti", "rome", "Monti / Esquilino", 41.8950, 12.4930),
        Zone("rome:parioli", "rome", "Parioli / Flaminio", 41.9280, 12.4880),
        Zone("rome:san-giovanni", "rome", "San Giovanni / Appio", 41.8790, 12.5150),
        Zone("rome:eur", "rome", "EUR", 41.8320, 12.4700),
        Zone("rome:monteverde", "rome", "Monteverde", 41.8760, 12.4520),
        Zone("rome:pigneto", "rome", "Pigneto / San Lorenzo", 41.8900, 12.5220),
        Zone("rome:nomentano", "rome", "Nomentano / Trieste", 41.9180, 12.5150),
        Zone("rome:ostia", "rome", "Ostia", 41.7310, 12.2760),
        Zone("barcelona:eixample", "barcelona", "Eixample", 41.3920, 2.1640),
        Zone("barcelona:gracia", "barcelona", "Gràcia", 41.4030, 2.1560),
        Zone("barcelona:gotic", "barcelona", "Ciutat Vella", 41.3830, 2.1760),
        Zone("barcelona:poblenou", "barcelona", "Poblenou", 41.4030, 2.2000),
        Zone("barcelona:sants", "barcelona", "Sants", 41.3750, 2.1350),
        Zone("barcelona:sarria", "barcelona", "Sarrià / Sant Gervasi", 41.4010, 2.1330),
        Zone("barcelona:horta", "barcelona", "Horta / Guinardó", 41.4250, 2.1650),
    ]
}


def zones_for_city(city_id: str) -> list[Zone]:
    return [z for z in ZONES.values() if z.city_id == city_id]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def zone_distance_km(zone_a: str | None, zone_b: str | None) -> float | None:
    a, b = ZONES.get(zone_a or ""), ZONES.get(zone_b or "")
    if not a or not b:
        return None
    return haversine_km(a.lat, a.lon, b.lat, b.lon)


def distance_band(km: float | None) -> str:
    if km is None:
        return "unknown"
    if km < 5:
        return "0-5"
    if km < 10:
        return "5-10"
    if km < 20:
        return "10-20"
    if km < 40:
        return "20-40"
    return "40+"
