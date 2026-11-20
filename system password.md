# System passwords (testing only)

Demo accounts created by `npm run seed:demo` (`server/scripts/seed-demo.js`). **Never use these on a real deployment.**

- **Password for every demo account below:** `Demo@12345`
- **Login ID** is the email address.
- **Admins** (super admin and department admins) also need a 6-digit authenticator code at every sign-in. Add this key to any authenticator app (Google Authenticator, Authy…): `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`
- **Super admin:** not created by the demo seed. It is the account you made with `npm run seed:super-admin -- --email <e> --name <n>`; its password is the one you set through the printed link.

## Admins

| Email | Name | Role | Password | 2nd step |
|---|---|---|---|---|
| (your own super admin) | – | Super admin | the one you set | yes |
| cse.admin@baiust.ac.bd | Dr. Mahbub Alam | CSE dept admin | Demo@12345 | yes |
| bba.admin@baiust.ac.bd | Ms. Nusrat Jahan | BBA dept admin | Demo@12345 | yes |
| eee.admin@baiust.ac.bd | Dr. Anwar Hossain | EEE dept admin | Demo@12345 | yes |
| civ.admin@baiust.ac.bd | Dr. Habibur Rahman | Civil dept admin | Demo@12345 | yes |
| law.admin@baiust.ac.bd | Adv. Kamrul Islam | Law dept admin | Demo@12345 | yes |
| eng.admin@baiust.ac.bd | Dr. Rubina Chowdhury | English dept admin | Demo@12345 | yes |
| eee.former.admin@baiust.ac.bd | Engr. Shahidul Islam | Former EEE admin (deactivated, cannot sign in) | Demo@12345 | – |

## Teachers

| Email | Name | Dept | State | Password |
|---|---|---|---|---|
| rahman.t@baiust.ac.bd | Md. Rahman (RHN) | CSE | active | Demo@12345 |
| karim.t@baiust.ac.bd | Dr. Abdul Karim (KRM) | CSE | active | Demo@12345 |
| ahmed.t@baiust.ac.bd | Farhana Ahmed (AHM) | CSE | active | Demo@12345 |
| tanjila.t@baiust.ac.bd | Tanjila Nowrin (TNJ) | CSE | active | Demo@12345 |
| mizan.t@baiust.ac.bd | Mizanur Rahman (MZR) | CSE | active | Demo@12345 |
| zahid.t@baiust.ac.bd | Dr. Zahid Hossain (ZHD) | CSE | active, teaches no section | Demo@12345 |
| hasan.t@baiust.ac.bd | Kamrul Hasan (HSN) | BBA | active | Demo@12345 |
| salma.t@baiust.ac.bd | Salma Begum (SLM) | BBA | active | Demo@12345 |
| farid.t@baiust.ac.bd | Farid Ahmed (FRD) | BBA | active | Demo@12345 |
| rubina.t@baiust.ac.bd | Rubina Yeasmin (RBN) | BBA | active | Demo@12345 |
| shahin.t@baiust.ac.bd | Shahin Alam (SHN) | BBA | active | Demo@12345 |
| eee.t1@baiust.ac.bd | Dr. Rezaul Karim (RZK) | EEE | active | Demo@12345 |
| eee.t2@baiust.ac.bd | Engr. Mahmudul Haque (MDH) | EEE | active | Demo@12345 |
| eee.t3@baiust.ac.bd | Sharmin Sultana (SHS) | EEE | active | Demo@12345 |
| eee.t4@baiust.ac.bd | Engr. Tarek Aziz (TRK) | EEE | active | Demo@12345 |
| eee.t5@baiust.ac.bd | Nilufa Yasmin (NLY) | EEE | active | Demo@12345 |
| eee.pending.t@baiust.ac.bd | Engr. Faisal Ahmed (FSL) | EEE | pending approval | Demo@12345 |
| civ.t1@baiust.ac.bd | Dr. Anisur Rahman (ANR) | CIV | active | Demo@12345 |
| civ.t2@baiust.ac.bd | Engr. Shafiqul Islam (SFQ) | CIV | active | Demo@12345 |
| civ.t3@baiust.ac.bd | Rokeya Khatun (RKY) | CIV | active | Demo@12345 |
| civ.t4@baiust.ac.bd | Engr. Mostafa Kamal (MKL) | CIV | active | Demo@12345 |
| civ.t5@baiust.ac.bd | Shirin Akter (SHR) | CIV | active | Demo@12345 |
| civ.pending.t@baiust.ac.bd | Engr. Jahidul Alam (JHD) | CIV | pending approval | Demo@12345 |
| law.t1@baiust.ac.bd | Adv. Sultana Razia (SRZ) | LAW | active | Demo@12345 |
| law.t2@baiust.ac.bd | Dr. Fazlul Haque (FZH) | LAW | active | Demo@12345 |
| law.t3@baiust.ac.bd | Adv. Monirul Islam (MNR) | LAW | active | Demo@12345 |
| law.t4@baiust.ac.bd | Tahmina Akter (TMA) | LAW | active | Demo@12345 |
| law.t5@baiust.ac.bd | Adv. Golam Mostafa (GLM) | LAW | active | Demo@12345 |
| law.pending.t@baiust.ac.bd | Adv. Nazmul Huda (NZH) | LAW | pending approval | Demo@12345 |
| eng.t1@baiust.ac.bd | Dr. Mahfuzur Rahman (MFR) | ENG | active | Demo@12345 |
| eng.t2@baiust.ac.bd | Shamima Nasrin (SMN) | ENG | active | Demo@12345 |
| eng.t3@baiust.ac.bd | Arifur Rahman (ARR) | ENG | active | Demo@12345 |
| eng.t4@baiust.ac.bd | Dr. Lutfun Nahar (LTN) | ENG | active | Demo@12345 |
| eng.t5@baiust.ac.bd | Zakir Hossain (ZKR) | ENG | active | Demo@12345 |
| eng.pending.t@baiust.ac.bd | Samia Rahman (SMR) | ENG | pending approval | Demo@12345 |
| nasir.t@baiust.ac.bd | Nasir Uddin | CSE | pending approval | Demo@12345 |
| jannat.t@baiust.ac.bd | Jannat Ara | BBA | pending approval | Demo@12345 |
| babul.t@baiust.ac.bd | Babul Mia | CSE | registration rejected | Demo@12345 |
| suspended.t@baiust.ac.bd | Rafiq Islam | CSE | suspended | Demo@12345 |
| selina.t@baiust.ac.bd | Selina Parvin | CSE | deactivated | Demo@12345 |
| unverified.t@baiust.ac.bd | Rashed Khan | CSE | email unverified | Demo@12345 |

## Students: named accounts

| Email | Name | Dept / section | State | Password |
|---|---|---|---|---|
| cr.a@baiust.ac.bd | Tanvir Hossain | CSE 1-I-A, CR | active | Demo@12345 |
| dcr.a@baiust.ac.bd | Ayesha Siddika | CSE 1-I-A, DCR | active | Demo@12345 |
| a1.student@baiust.ac.bd … a6.student@baiust.ac.bd | Sabbir Ahmed, Mim Akter, Rakib Hasan, Nusrat Sultana, Imran Khan, Lamia Rahman | CSE 1-I-A | active | Demo@12345 |
| b1.student@baiust.ac.bd | Shakil Mahmud | CSE 1-I-B, CR | active | Demo@12345 |
| b2.student@baiust.ac.bd | Tasnim Jahan | CSE 1-I-B, DCR | active | Demo@12345 |
| b3.student@baiust.ac.bd | Arif Billah | CSE 1-I-B | active | Demo@12345 |
| bba1.student@baiust.ac.bd | Sadia Afrin | BBA 1-I-A, CR | active | Demo@12345 |
| temp.password@baiust.ac.bd | Rubel Hossain | CSE 1-I-A | active, must change password at sign-in | Demo@12345 |
| bouncing@baiust.ac.bd | Sharmin Akter | CSE 1-I-A | active, email bouncing | Demo@12345 |

## Students: other account states

| Email | Name | State | Password |
|---|---|---|---|
| join.student@baiust.ac.bd | Jahid Hasan | claim_pending (asked to join CSE 1-I-A) | Demo@12345 |
| join2.student@baiust.ac.bd | Sohel Rana | claim_pending (pending request) | Demo@12345 |
| join3.student@baiust.ac.bd | Keya Moni | claim_pending (pending request) | Demo@12345 |
| escalated.student@baiust.ac.bd | Rony Barua | claim_pending (request escalated to admin) | Demo@12345 |
| rejected.student@baiust.ac.bd | Nabil Hasan | claim_pending (request rejected) | Demo@12345 |
| appeal.student@baiust.ac.bd | Tamanna Islam | claim_pending (appeal open) | Demo@12345 |
| withdrawn.student@baiust.ac.bd | Rashid Alam | claim_pending (withdrawn) | Demo@12345 |
| revoked.student@baiust.ac.bd | Faria Rahman | claim_pending (enrolment revoked) | Demo@12345 |
| join.bba@baiust.ac.bd | Munira Haque | claim_pending, BBA | Demo@12345 |
| rejected.bba@baiust.ac.bd | Ovi Sarkar | claim_pending, BBA (rejected) | Demo@12345 |
| eee.join@baiust.ac.bd | Imtiaz Hasan | claim_pending, EEE 1-I-A (pending request) | Demo@12345 |
| civ.join@baiust.ac.bd | Sajib Mondal | claim_pending, CIV 1-I-A (pending request) | Demo@12345 |
| law.join@baiust.ac.bd | Mehedi Hasan | claim_pending, LAW 1-I-A (pending request) | Demo@12345 |
| eng.join@baiust.ac.bd | Tonmoy Das | claim_pending, ENG 1-I-A (pending request) | Demo@12345 |
| unconfirmed.student@baiust.ac.bd | Mahin Chowdhury | unconfirmed | Demo@12345 |
| unconfirmed2.student@baiust.ac.bd | Shuvo Roy | unconfirmed (applied to 2-I-A) | Demo@12345 |
| not.enrolled@baiust.ac.bd | Moumita Paul | unconfirmed (marked not enrolled) | Demo@12345 |
| unverified.student@baiust.ac.bd | Pritom Das | email_unverified | Demo@12345 |
| graduated.student@baiust.ac.bd | Old Student | graduated | Demo@12345 |
| deactivated.student@baiust.ac.bd | Inactive Student | deactivated | Demo@12345 |

## Students: bulk accounts (all active, password `Demo@12345`)

Email pattern: `<prefix>.<NN>@baiust.ac.bd` with a two-digit number.

| Prefix | Numbers | Section | Notes |
|---|---|---|---|
| cse1ia | 01–16 | CSE 1-I-A | |
| cse1ib | 01–23 | CSE 1-I-B | |
| cse2ia | 01–26 | CSE 2-I-A | `cse2ia.01` is CR, `cse2ia.02` is DCR |
| cse3ia | 01–26 | CSE 3-I-A | no CR yet |
| bba1ia | 01–25 | BBA 1-I-A | `bba1ia.01` is DCR |
| bba1ib | 01–26 | BBA 1-I-B | `bba1ib.01` is CR |
| bba2ia | 01–26 | BBA 2-I-A | `bba2ia.01` is CR |
| bba3iia | 01–26 | BBA 3-II-A | no CR yet |
| eee1ia | 01–26 | EEE 1-I-A | `eee1ia.01` is CR, `eee1ia.02` is DCR |
| eee2ia | 01–26 | EEE 2-I-A | `eee2ia.01` is CR, `eee2ia.02` is DCR |
| civ1ia | 01–26 | CIV 1-I-A | `civ1ia.01` is CR, `civ1ia.02` is DCR |
| civ2ia | 01–26 | CIV 2-I-A | `civ2ia.01` is CR, `civ2ia.02` is DCR |
| law1ia | 01–26 | LAW 1-I-A | `law1ia.01` is CR, `law1ia.02` is DCR |
| law2ia | 01–26 | LAW 2-I-A | `law2ia.01` is CR, `law2ia.02` is DCR |
| eng1ia | 01–26 | ENG 1-I-A | `eng1ia.01` is CR, `eng1ia.02` is DCR |
| eng2ia | 01–26 | ENG 2-I-A | `eng2ia.01` is CR, `eng2ia.02` is DCR |
| cse1iia | 01–02 | last semester's CSE 1-II-A | state unconfirmed |
| bba1iia | 01–02 | last semester's BBA 1-II-A | state unconfirmed |

Example: `cse1ia.05@baiust.ac.bd` / `Demo@12345`.

Source of truth for what each account is for: `docs/demo-data.md`.
