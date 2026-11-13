# Worked Example: The IT Landscape

Every stage guide uses this one small example, so the steps stay concrete. It is **invented** for this documentation: the names, systems and owners are made up, and none of it is the book's example or real data. Follow along in a scratch namespace, or just read.

The organisation in the example keeps an inventory of its applications and wants to answer questions about it.

## 1. The scheme and its scope record

Write this before collecting any term. It keeps the vocabulary from growing without limit.

| Field | Entry |
|---|---|
| Scheme | IT landscape |
| Purpose | Give architects, application owners and auditors one meaning for the words used in the application inventory |
| Decisions supported | Which applications handle personal data, who answers for each application, which applications depend on one that is being retired |
| Out of scope | Product and vendor names, hardware, project names |
| Stakeholders | Enterprise architecture, application owners, data protection, service desk |

Each term below is recorded with the source *Architecture board glossary* and the authority *Enterprise Architecture*.

## 2. Candidate terms and what happened to them

Collected from the inventory, the service desk's ticket categories and two architecture documents:

| Candidate | Decision |
|---|---|
| Application, App, Software system | One concept. *Application* is preferred; the other two become alternative labels |
| Web application, Web app | One concept: *Web application*, with *Web app* as an alternative label |
| Interface, API | One concept. *Interface* is preferred; *API* is an acronym, so it is an alternative label |
| Service | Two meanings, so two concepts that share a name and are told apart by a qualifier (see below) |
| Application owner, System owner | One concept: *Application owner* |
| Personal data, PII | One concept: *Personal data*, with *PII* as an alternative label |
| Other systems | Rejected: it is a catch-all that nobody can define |

## 3. The terms

| Preferred label | Qualifier | Alternative labels | Definition | Broader |
|---|---|---|---|---|
| Software | | | Programs and the components they are built from, kept and changed by people in the organisation. | — |
| Application | | App, Software system | A program that people or other programs use to carry out a business task, looked after as one unit. | Software |
| Web application | | Web app | An application that people use through a browser. | Application |
| Interface | | API | A defined way for one program to ask another for facts or for an action. | Software |
| Service | technical | | A function that one program offers to other programs through an interface. | Software |
| Service | business | | An outcome that the organisation provides to its customers or staff, such as paying an invoice. | Offering |
| Offering | | | Anything the organisation provides to people outside or inside it. | — |
| Data | | | Facts the organisation records about its customers, its money, its programs and its operations. | — |
| Personal data | | PII, Personal information | Facts about a living person who can be identified from them. | Data |
| Customer contact data | | | Personal facts that let the organisation reach a customer, such as an address or a phone number. | Personal data |
| Financial data | | | Facts about amounts of money, payments and accounts. | Data |
| Role | | | A set of duties that a person holds for the organisation. | — |
| Application owner | | System owner | The person who answers for the budget, changes and retirement of one application. | Role |

### Telling the two services apart

Both concepts have the preferred label *Service*, so each carries a qualifier, and each has a scope note:

- *Service (technical)*: use for a function that software offers to software. Not for something a customer receives.
- *Service (business)*: use for an outcome a customer or colleague receives. Not for a program function.

## 4. The taxonomy

Three levels at most, with the branches about equally deep:

- Software
  - Application
    - Web application
  - Interface
  - Service (technical)
- Offering
  - Service (business)
- Data
  - Personal data
    - Customer contact data
  - Financial data
- Role
  - Application owner

## 5. Related terms and mappings

Related links join concepts of different branches:

| From | Related to |
|---|---|
| Application | Personal data |
| Application | Application owner |

Mappings point to concepts of another scheme. The target scheme here is an invented partner glossary:

| Concept | Mapping | Target |
|---|---|---|
| Personal data | closeMatch | https://example.org/partner-glossary#PersonalInformation |
| Application | broadMatch | https://example.org/partner-glossary#SoftwareAsset |

## 6. Competency questions and the model they imply

| # | Question | What the model needs |
|---|---|---|
| 1 | Which applications process personal data? | Classes *Application* and *Data category*; relation *processes* from Application to Data category |
| 2 | Who owns each application, and when did the owner last confirm it? | Class *Person*; relation *owned by*; attribute *last confirmed* (a date) |
| 3 | Which applications depend on an application that is being retired? | Relation *depends on* from Application to Application; attribute *lifecycle status* |

Link *Application* to the concept Application and *Data category* to the concept Data. *Person* gets no link, because the vocabulary has no concept for a person yet; the "no concept" badge on the canvas stays until one is added.

## 7. A shape

Every application has exactly one owner, who is a person: the property `owned by` on *Application* has a minimum and a maximum count of 1 and the class *Person*.

## 8. A few individuals

| Individual | Class | Facts |
|---|---|---|
| Invoice Portal | Application | processes: Customer contact data; owned by: Pat Example; last confirmed: 2026-09-30 |
| Ledger | Application | processes: Financial data; owned by: Sam Sample; depends on: nothing |
| Pat Example | Person | |

## 9. A change request and its release

New question 4: *Which interfaces carry personal data?* The model cannot answer it yet, so a change request names it and proposes a relation *carries* from Interface to Data category. It adds something and changes nothing that exists, so the suggested version moves from 1.2.0 to **1.3.0** (minor). The decision, the question and the version are recorded in the change log.
