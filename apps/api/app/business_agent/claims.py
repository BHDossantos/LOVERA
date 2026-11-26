"""Guard against fabricated outcomes, ported from Jennifer (src/security/claims.ts).
Keep in sync there.

The agent may not state that a payment cleared, equipment was returned, or an
application was submitted without evidence or an attributed statement from Bruno.
"""
import re
from typing import Iterable, List

CLAIM_PATTERNS = [
    ('payment_completed', re.compile('\\b(payment|invoice|transfer|bill)\\b[^.!?]{0,60}\\b(has been|was|is)\\s+(paid|cleared|settled|sent|processed|completed)\\b|\\b(i|we|bruno)\\s+(have|has)\\s+(paid|settled|transferred)\\b|\\bpagamento\\b[^.!?]{0,40}\\b(effettuato|eseguito|pago|realizado)\\b', re.I)),
    ('payment_completed', re.compile('\\b(ho|abbiamo|bruno ha)\\s+(pagato|saldato|bonificato)\\b|\\b(já\\s+)?(paguei|pagamos|transferi)\\b|\\b(he|hemos|ya)\\s+(pagado|transferido)\\b|\\bfattura\\b[^.!?]{0,40}\\b(pagata|saldata)\\b|\\bfactura\\b[^.!?]{0,40}\\b(pagada)\\b', re.I)),
    ('document_signed', re.compile('\\b(ho|abbiamo)\\s+firmato\\b|\\b(assinei|assinamos)\\b|\\b(he|hemos)\\s+firmado\\b|\\bcontratto\\b[^.!?]{0,40}\\bfirmato\\b|\\bcontrato\\b[^.!?]{0,40}\\b(assinado|firmado)\\b', re.I)),
    ('callback_promised', re.compile('\\bbruno\\s+(ti|la|vi)\\s+(richiamerà|richiama)|\\bbruno\\s+(vai\\s+)?(te\\s+|lhe\\s+)?(ligar|retornar)\\b|\\bbruno\\s+(te|le|lo)\\s+(llamará|devolverá|llama)', re.I)),
    ('payment_completed', re.compile("\\b(j'ai|nous avons|avons)\\s+(payé|paye|réglé|regle|viré|vire)|\\bfacture\\b[^.!?]{0,40}\\b(payée|payee|réglée|reglee)", re.I)),
    ('document_signed', re.compile("\\b(j'ai|nous avons)\\s+signé|\\bcontrat\\b[^.!?]{0,40}\\bsigné", re.I)),
    ('callback_promised', re.compile('\\bbruno\\s+(vous|te)\\s+(rappellera|recontactera)', re.I)),
    ('item_returned', re.compile('\\b(equipment|device|item|keys?|package|laptop)\\b[^.!?]{0,60}\\b(has been|was)\\s+(returned|shipped back|sent back|dropped off)\\b', re.I)),
    ('application_submitted', re.compile('\\b(application|form|claim|request)\\b[^.!?]{0,60}\\b(has been|was)\\s+(submitted|filed|sent)\\b|\\b(i|we|bruno)\\s+(have|has)\\s+(applied|submitted|filed)\\b', re.I)),
    ('document_signed', re.compile('\\b(contract|agreement|document)\\b[^.!?]{0,60}\\b(has been|was|is)\\s+signed\\b|\\b(i|we|bruno)\\s+(have|has)\\s+signed\\b', re.I)),
    ('callback_promised', re.compile('\\b(bruno|he|she|they)\\s+will\\s+(call|get back to)\\s+you\\b', re.I)),
]


def detect_claims(text: str) -> List[str]:
    return [k for k, rx in CLAIM_PATTERNS if rx.search(text)]


def unsupported_claims(text: str, supported: Iterable[str] = ()) -> List[str]:
    ok = set(supported)
    return [c for c in detect_claims(text) if c not in ok]
