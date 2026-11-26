"""Untrusted content handling, ported from Jennifer (github.com/BHDossantos/jennifer,
src/security/untrusted.ts). Keep in sync there.

Emails, messages, websites, documents and tool outputs are data, never
instructions. They are wrapped with provenance labels before reaching a model,
and suspicious content is flagged and preserved as evidence. Enforcement does
not rely on detection: this package cannot act at all.

Some patterns are adapted from OpenJarvis security/injection_scanner.py
(Apache-2.0); see THIRD_PARTY_LICENSES in this folder.
"""
import re
from dataclasses import dataclass, field
from typing import List

INJECTION_PATTERNS = [
    ('instruction_override', re.compile('\\b(ignore|disregard|forget)\\b[^.]{0,40}\\b(previous|prior|above|your|all)\\b[^.]{0,20}\\b(instructions|rules|prompt|guidelines)\\b', re.I)),
    ('exfiltration_request', re.compile('\\b(forward|send|share|export|upload)\\b[^.]{0,60}\\b(all|every|entire)\\b[^.]{0,40}\\b(emails?|messages|statements|documents|files|contacts|history)\\b', re.I)),
    ('credential_request', re.compile('\\b(send|share|provide|tell|give|reply with|enter|confirm)\\b[^.]{0,40}\\b(password|verification code|2fa|otp|one[- ]time code|authentication code|security code|login code)\\b', re.I)),
    ('settings_change', re.compile('\\b(change|update|disable|turn off)\\b[^.]{0,40}\\b(settings|permissions|forwarding|rules|security|2fa)\\b', re.I)),
    ('role_play', re.compile('\\b(you are now|act as|new system prompt|developer mode)\\b|\\b(system|assistant)\\s*:', re.I)),
    ('instruction_override', re.compile('\\b(ignora|ignore|ignorar|dimentica|esqueça|esquece|olvida)\\b[^.]{0,40}\\b(istruzioni|regole|instruções|instrucoes|regras|instrucciones|reglas)\\b', re.I)),
    ('exfiltration_request', re.compile('\\b(inoltra|invia|inviami|manda|mandami|condividi|encaminhe|encaminha|envie|envia|compartilhe|reenvía|reenvia|envía|envíame|enviame|mándame|comparte)\\b[^.]{0,60}\\b(tutte|tutti|todas|todos)\\b[^.]{0,40}\\b(e-?mails?|messaggi|mensagens|mensajes|estratti|extratos|extractos|documenti|documentos|contatti|contatos|contactos|correos)\\b', re.I)),
    ('credential_request', re.compile('\\b(invia|inviami|dimmi|fornisci|manda|envie|me envie|informe|diga|envíame|envíe|dime|proporciona)\\b[^.]{0,40}\\b(password|senha|contraseña|codice di verifica|codice otp|código de verificação|código de verificación|código|codice)\\b', re.I)),
    ('settings_change', re.compile('\\b(cambia|modifica|disattiva|altere|mude|desative|desativa|desactiva|cambie)\\b[^.]{0,40}\\b(impostazioni|permessi|inoltro|configurações|permissões|encaminhamento|configuración|permisos|reenvío)\\b', re.I)),
    ('instruction_override', re.compile('\\b(ignorez|ignore|oubliez)\\b[^.]{0,40}\\b(instructions|règles|regles|consignes)\\b', re.I)),
    ('exfiltration_request', re.compile('\\b(transférez|transferez|envoyez|envoyez-moi|partagez)\\b[^.]{0,60}\\b(tous|toutes)\\b[^.]{0,40}\\b(e-?mails?|messages|relevés|releves|documents|contacts|fichiers)\\b', re.I)),
    ('credential_request', re.compile('\\b(envoyez|envoyez-moi|donnez|communiquez)\\b[^.]{0,40}\\b(mot de passe|code de vérification|code de verification|code)\\b', re.I)),
    ('identity_override', re.compile('\\byou\\s+are\\s+now\\s+(?:a\\s+)?(?:different|new|my)\\b', re.I)),
    ('code_injection', re.compile('\\b(?:execute|run|eval)\\s*\\(\\s*[\'"]', re.I)),
    ('shell_injection', re.compile('(?:;|\\||&&)\\s*(?:rm|curl|wget|nc|ncat|bash|sh|python|perl)\\s', 0)),
    ('exfiltration_url', re.compile('\\b(?:send|post|upload|exfiltrate|transmit)\\s+(?:(?:to|data|all|everything)\\s+)*(?:to\\s+)?(?:https?:\\/\\/|my\\s+server)', re.I)),
    ('encoded_exfiltration', re.compile('\\bbase64\\s+encode\\s+(?:and\\s+)?(?:send|include|append)', re.I)),
    ('jailbreak', re.compile('\\b(?:DAN|do\\s+anything\\s+now)\\s+(?:mode|prompt|jailbreak)|\\bpretend\\s+(?:you\\s+)?(?:have\\s+)?no\\s+(?:restrictions?|limitations?|rules?|filters?)', re.I)),
    ('delimiter_injection', re.compile('```(?:system|assistant)\\b|<\\|(?:im_start|im_end|system|assistant)\\|>', re.I)),
    ('hidden_text', re.compile('[\\u200B-\\u200F\\u2060\\uFEFF]|<span[^>]*(display:\\s*none|font-size:\\s*0)', re.I)),
]


@dataclass
class UntrustedBlock:
    source: str
    content: str
    flags: List[str] = field(default_factory=list)


def detect_injection(text: str) -> List[str]:
    return list(dict.fromkeys(k for k, rx in INJECTION_PATTERNS if rx.search(text)))


def sanitize_for_model(text: str) -> str:
    """Remove markup that could hide instructions; keep visible text as evidence."""
    # Strip until nothing changes, so removing one tag cannot join the text
    # around it into a new tag (for example "<scr<b></b>ipt>").
    out = text
    while True:
        prev = out
        out = re.sub(r"<script\b[^>]*>[\s\S]*?</script[^>]*>", "", out, flags=re.I)
        out = re.sub(r"<style\b[^>]*>[\s\S]*?</style[^>]*>", "", out, flags=re.I)
        out = re.sub(r"<[^>]+>", " ", out)
        if out == prev:
            break
    # A "<" left over (from an unclosed tag) can't start markup once escaped.
    out = out.replace("<", "&lt;")
    out = re.sub("[\u200B-\u200F\u2060\uFEFF]", "", out)
    out = re.sub(r"\s+\n", "\n", out)
    return out.strip()


def wrap_untrusted(source: str, content: str) -> UntrustedBlock:
    return UntrustedBlock(source=source, content=sanitize_for_model(content), flags=detect_injection(content))


def render_untrusted(block: UntrustedBlock, nonce: str) -> str:
    """Render for a model prompt. Delimiters are randomized per call so embedded text cannot forge a closing tag."""
    flag_note = f' flags="{",".join(block.flags)}"' if block.flags else ""
    safe = "".join(block.content.split(f"</untrusted-{nonce}>"))
    return f'<untrusted-{nonce} source="{block.source}"{flag_note}>\n{safe}\n</untrusted-{nonce}>'
