"""Lovera's business agent, ported from Jennifer (src/company/businessAgents.ts).
Generated; edit in Jennifer and re-port.
"""

BUSINESS_AGENTS = [
    {
        "companyId": "dating",
        "name": "Lovera agent",
        "mission": "Find Lovera’s first couples and partners and turn interest into signups or waitlist entries.",
        "routine": {
            "name": "Lovera",
            "does": "Daily campaign pack and up to five new qualified early users or partners."
        },
        "guardrails": [
            "No mobile release claims unless the approved brain confirms one.",
            "One early-user or partner segment at a time, with a call to action that works today."
        ],
        "measures": [
            "qualified replies",
            "signups or waitlist entries",
            "partner conversations"
        ],
        "tasks": [
            {
                "id": "partners",
                "name": "Qualify partners and early users",
                "department": "sales",
                "cadence": "daily",
                "does": "Qualify partners and early-user groups for the chosen segment. The daily Claude routine finds and drafts; this task qualifies what it logged, drops duplicates and anyone on the do-not-contact list, and proposes the next step for each.",
                "inputs": [
                    "icp",
                    "offer",
                    "CRM contacts"
                ],
                "outputs": [
                    "partner outreach drafts",
                    "CRM tasks"
                ],
                "approval": "Drafts and CRM changes wait for Bruno."
            },
            {
                "id": "content",
                "name": "Couples content week",
                "department": "marketing",
                "cadence": "weekly",
                "does": "Plan the week of posts for the chosen segment, each with the working call to action.",
                "inputs": [
                    "offer",
                    "brand",
                    "claims",
                    "audience"
                ],
                "outputs": [
                    "post drafts"
                ],
                "approval": "Each post waits for Bruno."
            },
            {
                "id": "signups",
                "name": "Signup follow-up",
                "department": "customer",
                "cadence": "weekly",
                "does": "Review new signups and waitlist entries and propose a welcome or follow-up message.",
                "inputs": [
                    "faq",
                    "procedures"
                ],
                "outputs": [
                    "follow-up drafts"
                ],
                "approval": "Messages wait for Bruno."
            }
        ]
    }
]

BUSINESS_AGENT = BUSINESS_AGENTS[0]
