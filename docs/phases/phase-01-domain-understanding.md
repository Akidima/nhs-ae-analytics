# NHS A&E Demand and Emergency Admissions Analytics Platform
## Phase 1: Healthcare Domain Understanding

**Project:** NHS A&E Demand and Emergency Admissions Analytics  
**Phase:** 1 of 13  
**Deliverables:** Business glossary, KPI glossary, operational reporting concepts  
**Next Phase:** Phase 2 — Data Source Analysis

---

## 🧒 Explain Like I'm 10

> **The whole project is a restaurant kitchen** that turns messy boxes of ingredients into beautiful plated meals. Each phase is a job in that kitchen, and the same story runs through every phase of this project.
>
> **Phase 1 is "learn what food you're cooking."** Before you open a restaurant, you study the food. Here, the "food" is hospital emergency-room data — A&E.
>
> A&E is the part of a hospital you rush to when something is really wrong. People arrive, they wait, and then one of two things happens: they get sent home, or they get given a hospital bed (that's an "admission"). There's a famous rule that says a patient should be sorted out within **4 hours**. When hospitals beat that rule, that's good. When they don't, that's bad, and people end up waiting on trolleys in corridors.
>
> In this phase we learned all the kitchen vocabulary — what a "visit" is, what an "admission" is, what counts as good and bad, and who all the hospitals and bosses are. You can't cook a dish you don't understand, and you can't build a report about hospitals without first knowing how hospitals work. **That's all Phase 1 is: learning the food before touching a single pan.**

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [NHS England Operational Reporting Ecosystem](#2-nhs-england-operational-reporting-ecosystem)
3. [A&E Attendance Workflow](#3-ae-attendance-workflow)
4. [Emergency Admissions Process](#4-emergency-admissions-process)
5. [4-Hour Target Measurement](#5-4-hour-target-measurement)
6. [Provider Reporting Structures](#6-provider-reporting-structures)
7. [Integrated Care Boards (ICBs)](#7-integrated-care-boards-icbs)
8. [Trust-Level Performance Monitoring](#8-trust-level-performance-monitoring)
9. [Winter Pressure Planning](#9-winter-pressure-planning)
10. [Business Glossary](#10-business-glossary)
11. [KPI Glossary](#11-kpi-glossary)
12. [Operational Reporting Concepts for Engineers](#12-operational-reporting-concepts-for-engineers)

---

## 1. Project Overview

### Why This Project Exists

The NHS processes approximately **25 million A&E attendances every year**. Behind each number is a patient — possibly waiting hours in a corridor, or being admitted to a hospital ward that may have no available beds.

Emergency care performance is one of the most politically and clinically visible metrics in UK public life. It drives frontpage headlines, parliamentary questions, and operational decisions affecting tens of millions of people.

The ability to ingest, clean, validate, model, and visualise this data at national and trust level is not optional infrastructure for NHS planners. It is essential infrastructure.

This platform automates the full pipeline so that decision-makers never need to manually download an Excel file and pivot it themselves again.

### What the Platform Delivers

| Capability | Business Outcome |
|------------|-----------------|
| Monthly automated ingestion | No manual downloads or processing |
| Trust-level dimensional model | Enables cross-trust benchmarking |
| KPI calculation layer | Consistent, governed metric definitions |
| Data quality framework | Errors caught before they reach dashboards |
| Power BI dashboards | Decision-ready operational reporting |
| Historical timeseries | Trend analysis and year-on-year comparisons |
| Revision detection | Corrections automatically applied |

### Who Uses This Data

| User | Use Case |
|------|----------|
| NHS England national teams | Monitoring national emergency care performance |
| ICB performance teams | Monitoring provider performance in their geography |
| Trust operational directors | Monitoring their own A&E department |
| Winter pressure planning teams | Forecasting demand, planning capacity |
| Finance and commissioning teams | Budget planning based on activity volumes |
| Media and public | Scrutinising NHS performance through published statistics |

---

## 2. NHS England Operational Reporting Ecosystem

### Overview

NHS England is the arm's length body responsible for commissioning and overseeing NHS services in England. It publishes statistical data through its statistics and data science function (formerly NHS Digital, merged into NHS England in 2023).

A&E performance data sits within the **"A&E Attendances and Emergency Admissions"** statistical series.

### The Reporting Ecosystem

```
┌─────────────────────────────────────────────────────────────────┐
│                     NHS TRUST SYSTEMS                           │
│   Clinical systems generate A&E attendance records monthly      │
└─────────────────────────┬───────────────────────────────────────┘
                          │  Trusts submit data to NHS England
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NHS ENGLAND STATISTICS                        │
│   Data received → validation → aggregation → publication        │
└─────────────────────────┬───────────────────────────────────────┘
                          │  Published ~3-4 weeks after month end
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│               NHS ENGLAND PUBLIC WEBSITE                         │
│   XLS files downloadable at:                                    │
│   england.nhs.uk/statistics/statistical-work-areas/             │
│   ae-waiting-times-and-activity/                                │
└─────────────────────────┬───────────────────────────────────────┘
                          │  Our pipeline detects and ingests
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│               OUR ANALYTICS PLATFORM                             │
│   Raw → Staging → Warehouse → Dashboards                        │
└─────────────────────────────────────────────────────────────────┘
```

### Publication Schedule

- Data is published monthly
- Typical lag: **3–4 weeks** after the reporting month ends
- Example: January 2025 data published approximately late February / early March 2025
- NHS England sometimes publishes provisional data followed by a final revision

### Publication URL

```
https://www.england.nhs.uk/statistics/statistical-work-areas/ae-waiting-times-and-activity/
```

### File Types Published

| File Type | Content | Format |
|-----------|---------|--------|
| Monthly XLS | Current month trust-level data | Excel (.xls) |
| Timeseries XLS | Historical data (all months, consolidated) | Excel (.xls) |
| Supplementary CSV | Occasionally published for specific breakdowns | CSV |

The **timeseries file** is particularly important for our project. It consolidates all historical months into a single file, enabling bulk historical load.

### Revision Policy

NHS England issues revisions when:
- A trust submits corrected data after initial publication
- A data quality issue is identified post-publication
- A trust's ODS code or name changes
- A trust merges with or acquires another trust

**Engineering implication:** Our ingestion layer must detect when a previously loaded month has been revised and reprocess it. This is handled through a file hash comparison and metadata versioning system (built in Phase 5).

---

## 3. A&E Attendance Workflow

### What Counts as an Attendance

An A&E attendance is recorded when a patient registers at an A&E department. The clock starts at registration.

### The Patient Journey Through A&E

```
PATIENT ARRIVES
       │
       ▼
REGISTRATION ──────────────── CLOCK STARTS HERE
       │
       ▼
TRIAGE (clinical prioritisation)
       │
       ▼
INITIAL ASSESSMENT
       │
       ▼
INVESTIGATION / TREATMENT
(bloods, imaging, senior review, procedures)
       │
       ▼
DECISION POINT
       │
       ├──► DISCHARGE ───────────────── CLOCK STOPS ✓ (within or >4hrs)
       │    (home, GP follow-up,
       │     community care)
       │
       ├──► ADMITTED TO WARD ─────────── CLOCK STOPS ✓ (within or >4hrs)
       │    (patient moves to inpatient bed)
       │
       ├──► TRANSFERRED ─────────────── CLOCK STOPS ✓ (within or >4hrs)
       │    (sent to another hospital)
       │
       ├──► LEFT BEFORE BEING SEEN ───── COUNTED AS ATTENDANCE
       │    (LBBS — patient leaves before assessment)
       │
       └──► DIED IN A&E ──────────────── COUNTED AS ATTENDANCE
```

### A&E Department Types — Detailed Breakdown

Understanding type categorisation is critical because:
1. Different types have different clinical mandates
2. Performance targets have different application by type
3. Our data model stores type as a dimension attribute

| Type | Official Definition | Clinical Mandate | 4-Hour Target Applies? |
|------|-------------------|-----------------|------------------------|
| **Type 1** | Major emergency department — consultant-led, 24/7, full range of emergencies with full resuscitation facilities | Highest acuity — life-threatening emergencies | Yes — primary measure |
| **Type 2** | Single-specialty emergency department — consultant-led, covers one specialty only | Specialty emergencies (e.g., ophthalmology, orthopaedics) | Yes — secondary measure |
| **Type 3** | Other A&E / Urgent Treatment Centre / Minor Injury Unit | Lower acuity — minor injuries, minor illness | Yes — but less scrutinised |

**Examples by type:**

- Type 1: Royal London Hospital A&E, Manchester Royal Infirmary A&E
- Type 2: Moorfields Eye Hospital Emergency Department
- Type 3: Urgent Treatment Centres, Walk-In Centres, Minor Injury Units

### Why Type 3 Matters for System Analysis

If a trust opens more Type 3 capacity (minor injury units), it can deflect lower-acuity patients from its Type 1 department. This:
- Reduces Type 1 attendances
- Improves Type 1 4-hour performance
- Increases Type 3 attendances

An analyst who does not understand type distribution could misinterpret a performance improvement as clinical improvement when it is actually a capacity configuration change.

**Our dashboard must show type breakdown alongside total performance.**

### Counting Rules

| Scenario | How Counted |
|----------|-------------|
| Walk-in patient | 1 attendance at receiving trust |
| Ambulance-conveyed patient | 1 attendance at receiving trust |
| Patient transferred to another A&E | 2 attendances total (1 per department) |
| Patient returns within 24 hours | 1 attendance (unless re-registered as new) |
| Patient leaves before being seen | 1 attendance (LBBS flag) |
| Patient dies in A&E | 1 attendance |

---

## 4. Emergency Admissions Process

### Admission vs. Attendance

These are two different events that are often conflated:

| Event | Definition |
|-------|-----------|
| **Attendance** | Patient visits and registers at A&E |
| **Admission** | Patient is taken from A&E to a hospital inpatient bed |

Every emergency admission via A&E begins with an attendance, but most attendances do **not** result in an admission. Approximately 25–35% of Type 1 attendances result in emergency admission.

### How an Emergency Admission is Triggered

```
Patient in A&E (during attendance)
         │
         ▼
   Clinician decides patient requires inpatient care
   This is the DECISION TO ADMIT (DTA)
         │
         ▼
   Bed Management contacted
         │
         ├──► Bed available? → Patient transferred to ward → ADMISSION RECORDED
         │
         └──► No bed available? → Patient waits in A&E on trolley (BOARDING)
              │
              ├──► Bed becomes available → ADMITTED (possibly >4hrs, >12hrs DTA)
              └──► No bed → Patient deteriorates in corridor
```

### The Boarding Problem

When a patient has had their Decision to Admit but no bed is available:
- They **remain in A&E** occupying a cubicle or corridor space
- They **count as an attendance** that is still in progress
- If they wait >4 hours, they become a 4-hour breach
- If they wait >12 hours from DTA, they become a 12-hour DTA breach

This boarding cascade is the primary driver of A&E 4-hour performance failure in England. It is a **downstream problem** (insufficient ward capacity or slow discharge) creating an **upstream crisis** (A&E cannot offload patients).

Our platform visualises this through the **Emergency Admission Conversion Rate** — a high rate indicates the A&E is dealing with a genuinely sick population, implying significant bed pressure.

### Sources of Emergency Admissions (Not All Via A&E)

The A&E dataset only captures admissions that flow through A&E. There are other emergency admission routes:

| Route | Captured in A&E Dataset? |
|-------|--------------------------|
| Via A&E (Type 1) | ✅ Yes |
| Via A&E (Type 2) | ✅ Yes |
| Via A&E (Type 3) | ✅ Yes |
| GP emergency referral (direct admission) | ❌ No |
| Ambulance direct admission (bypassing A&E) | ❌ No |
| Consultant-to-consultant emergency referral | ❌ No |
| Emergency maternity admission | ❌ No |

**This is important for data consumers.** Total emergency admissions nationally is larger than what is captured in this dataset. The dataset specifically measures A&E-routed admissions.

### Key Admission KPIs

```sql
-- Admission Conversion Rate (most important admission KPI)
Admission Conversion Rate = 
    SUM(emergency_admissions_via_ae) / SUM(total_attendances) * 100

-- Expected range: 25-35% for Type 1 departments
-- Above 40%: Very high acuity — significant bed pressure likely
-- Below 20%: Lower acuity population or high deflection to Type 3
```

---

## 5. 4-Hour Target Measurement

### History of the Standard

The 4-hour standard was introduced in **2004** as part of the Labour government's NHS Plan. At its peak (~2012), over **98%** of patients were being seen within 4 hours nationally.

Since then, driven by increasing demand, reduced bed capacity, social care pressures, and staffing challenges, performance has declined significantly.

### The Standard — Technical Definition

> **95% of all A&E attendances should be admitted, transferred, or discharged within 4 hours of arrival.**

Note the precision: it is 4 hours from **arrival/registration** to **final outcome** (admit/discharge/transfer). It is not 4 hours from triage, from assessment, or from decision to admit.

### Clock Mechanics

```
T=0:00  Patient arrives and registers at A&E reception
         ──────────────────────────────────────────────
T=0:30  Triage completed
T=1:00  Seen by nurse
T=2:30  Seen by doctor
T=3:00  Blood results reviewed
T=3:30  Decision made: patient can go home with antibiotics
         ──────────────────────────────────────────────
T=3:45  Patient discharged ← CLOCK STOPS ✅ Within 4 hours

Outcome: NOT a 4-hour breach (under 4:00)
```

```
T=0:00  Patient arrives and registers
         ──────────────────────────────────────────────
T=0:45  Triage completed (high priority)
T=1:30  Seen by doctor
T=2:00  Decision to Admit made
T=2:30  Bed requested — no beds available
T=4:00  ── 4-HOUR MARK ──
T=5:30  Bed found on a ward, patient transferred
         ──────────────────────────────────────────────
T=5:30  Patient admitted ← CLOCK STOPS ❌ After 4 hours

Outcome: 4-HOUR BREACH (over 4:00)
```

### Calculation Formula

```sql
-- 4-Hour Performance Rate
performance_pct = 
    (total_attendances - attendances_gt_4hrs) / total_attendances * 100

-- Number of breaches
breaches = attendances_gt_4hrs

-- Number within target
within_target = total_attendances - attendances_gt_4hrs
```

### Performance Benchmarks Over Time

| Financial Year | National 4-Hour Performance (All Types) |
|---------------|----------------------------------------|
| 2012–13 | 97.8% |
| 2014–15 | 93.0% |
| 2016–17 | 89.1% |
| 2018–19 | 85.1% |
| 2019–20 | 83.6% |
| 2020–21 | 88.1% (COVID-reduced attendances) |
| 2021–22 | 79.0% |
| 2022–23 | 71.2% |
| 2023–24 | 73.5% |

The 95% target has not been achieved nationally since **July 2015**.

### The New Performance Framework (2023 Onwards)

NHS England introduced a new framework to replace the legacy 95% target:

| Measure | Target | Notes |
|---------|--------|-------|
| Type 1 4-hour performance | 76% (interim) | Acknowledges 95% is not achievable near-term |
| 12-hour waits from arrival | 0% (aspiration) | Any patient in A&E >12 hours from arrival |
| 12-hour Decision to Admit (DTA) | 0% (aspiration) | Any patient waiting >12hrs after DTA decision |

**Engineering note:** Our data warehouse stores all available measures. The KPI calculation layer applies the appropriate target based on the reporting period — legacy periods use 95%, current periods use 76% for Type 1.

### 12-Hour Measures — Why They Matter More Than 4-Hour

A 12-hour wait in an emergency department is a **patient safety event**. Evidence shows that patients boarding in A&E corridors for 8–12+ hours experience:
- Increased risk of clinical deterioration
- Missed medication doses
- Inadequate monitoring
- Higher mortality in some patient groups

The 12-hour measure (particularly DTA) has become the primary quality indicator. However, the A&E dataset does not publish 12-hour DTA counts directly at provider level — this comes from the ECDS (Emergency Care Data Set), which is a Phase 12 enhancement in our roadmap.

---

## 6. Provider Reporting Structures

### NHS Trusts — The Reporting Unit

In the A&E dataset, data is reported at **NHS Trust level**. Each trust is a single row per reporting period.

An NHS Trust is an organisation that delivers healthcare. It may operate multiple hospitals and A&E departments, but its A&E data is aggregated across all its sites in this dataset.

For example:
- **Barts Health NHS Trust** operates the Royal London, St Bartholomew's, Whipps Cross, Newham, and Mile End hospitals. All are reported under a single trust code.

### ODS Codes — The Primary Identifier

Every NHS organisation has an **ODS (Organisation Data Service) code**:

```
Format: 3–5 alphanumeric characters
Examples:
  R1H  → Barts Health NHS Trust
  RJ1  → Guy's and St Thomas' NHS Foundation Trust
  RRV  → University College London Hospitals NHS Foundation Trust
  RTH  → Oxford University Hospitals NHS Foundation Trust
  RM3  → Northern Care Alliance NHS Foundation Trust
```

ODS codes are managed by NHS England's Organisation Data Service:
```
https://digital.nhs.uk/services/organisation-data-service
```

### Trust Types Relevant to A&E

| Trust Type | A&E Relevance |
|------------|--------------|
| Acute NHS Trust | Primary provider of A&E services |
| NHS Foundation Trust | Same clinical services as acute trusts; greater financial independence |
| Specialist Trust | May have Type 2 A&E (e.g., eye hospitals) |
| Ambulance Trust | No A&E department |
| Mental Health Trust | No A&E department |
| Community Trust | May have Type 3 / UTC |

### Provider Changes Over Time — A Critical Engineering Challenge

This is one of the most complex data engineering challenges in NHS analytics:

| Change Type | Example | Engineering Response |
|-------------|---------|---------------------|
| Trust merger | Two trusts become one → new ODS code | SCD Type 2 in dim_provider; historical data linked to old codes |
| Trust split | One trust becomes two | SCD Type 2; backfill decisions required |
| Trust rename | Same ODS code, new name | SCD Type 2; name change tracked with effective dates |
| ODS code change | Rare but happens | Bridge table required |
| New trust | New ODS code appears | Automatically inserted in dim_provider |
| Trust dissolution | Trust disbands; code removed | SCD — marked as inactive |

**Example merger:**
- **Wrightington, Wigan and Leigh NHS Trust** (RRF) + **Bridgewater Community Healthcare** merged into **Northern Care Alliance NHS Foundation Trust** (RM3).
- Historical data exists under RRF. Current data appears under RM3.
- Our platform must allow users to compare "equivalent" periods across the merger boundary.

### NHS Geographic Hierarchy

```
NATIONAL (NHS England)
        │
        ├── Region 1: North East and Yorkshire
        ├── Region 2: North West
        ├── Region 3: Midlands
        ├── Region 4: East of England
        ├── Region 5: London
        ├── Region 6: South East
        └── Region 7: South West
                │
                └── 42 Integrated Care Boards (one per geographic area)
                            │
                            └── NHS Trusts (providers)
```

### Trust Count

Approximately **130–140 NHS trusts** with Type 1 A&E departments report in any given month. The total number of organisations in the dataset is higher when including Type 2 and Type 3 only providers.

---

## 7. Integrated Care Boards (ICBs)

### What ICBs Are

Integrated Care Boards (ICBs) were established in **July 2022** under the Health and Care Act 2022. They replaced **Clinical Commissioning Groups (CCGs)**, of which there were 106.

There are now **42 ICBs** in England.

ICBs are the statutory commissioning organisations responsible for:
- Planning NHS services for their population
- Contracting with NHS providers (trusts)
- Managing the NHS budget at local level
- Monitoring provider performance
- Leading on population health planning

### ICB Examples

| ICB Code | ICB Name | Geography |
|----------|----------|-----------|
| QMF | NHS Greater Manchester ICB | Greater Manchester |
| QMJ | NHS West Yorkshire ICB | West Yorkshire |
| QRV | NHS North Central London ICB | North Central London |
| QMK | NHS Black Country ICB | Black Country |
| QNQ | NHS Bristol, North Somerset and South Gloucestershire ICB | Bristol area |

### ICB Performance Responsibilities

ICBs use A&E data to:
1. Monitor the A&E performance of trusts they commission
2. Report upward to NHS England on system performance
3. Identify trusts requiring support or intervention
4. Plan winter surge capacity
5. Invest in deflection strategies (e.g., funding UTC expansion)

### ICBs in Our Data Model — A Join Challenge

The A&E dataset **does not include ICB codes**. ICB membership of a trust must be maintained as a **reference data lookup** joined to the trust ODS code.

This reference data changes over time:
- When new ICBs are formed (initial July 2022 transition)
- When ICBs are reconfigured
- When trust boundaries change

Our `dim_provider` table maintains the trust → ICB → Region hierarchy with effective dates.

### ICB Reference Data Source

ICB membership can be maintained from:
```
https://digital.nhs.uk/services/organisation-data-service/export-data-files/
csv-downloads/ods-weekly-publication
```

The ODS weekly publication includes current and historical organisation relationships.

---

## 8. Trust-Level Performance Monitoring

### The Monthly Reporting Cycle — From Clinical System to Dashboard

```
Day 0:  Month ends (e.g., 31st March)
Day 7:  NHS trusts compile and submit A&E data
Day 14: NHS England receives submissions
Day 21: NHS England validates and aggregates data
Day 28: Statistical publication released on NHS England website
Day 29: Our Airflow pipeline detects new file via webpage scrape
Day 29: File downloaded to raw storage (S3 / Azure Blob)
Day 29: Great Expectations validation runs against raw file
Day 29: Data staged into PostgreSQL staging schema
Day 29: dbt models run: staging → intermediate → marts
Day 29: Power BI dataset refreshes
Day 30: Operational teams access updated dashboards
```

### What Is Monitored at Trust Level

| Monitoring Dimension | Questions It Answers |
|---------------------|---------------------|
| **Volume** | Are attendances rising or falling? Seasonally expected? |
| **Performance** | What % within 4 hours? Above/below target? Above/below peers? |
| **Trend** | Is performance improving or getting worse over time? |
| **Seasonality** | Is this month's performance as expected for the time of year? |
| **Acuity** | How sick are the patients? (Admission conversion rate proxy) |
| **Outliers** | Which trusts are statistical outliers? |
| **Type mix** | What proportion of attendances are Type 1/2/3? |

### RAG Performance Framework

NHS operational reporting uses Red/Amber/Green (RAG) ratings:

| RAG | 4-Hour Performance | Meaning |
|-----|--------------------|---------|
| 🔴 Red | Below 70% | Significant concern; likely systemic issues |
| 🟡 Amber | 70–89% | Underperforming; monitoring required |
| 🟢 Green | 90%+ | Acceptable performance (though below 95% target) |

**Important:** RAG thresholds vary by organisation and reporting period. Our Power BI dashboard makes thresholds configurable via parameters.

### Peer Benchmarking in Practice

Trusts are not compared uniformly. Relevant peer groups include:
- **Volume peers:** Trusts with similar attendance volumes (prevents unfair comparison of a 300,000-attendance trust vs a 50,000-attendance trust)
- **Geography peers:** Trusts within the same ICB or region
- **Type mix peers:** Trusts with similar proportions of Type 1 vs Type 3 attendances
- **National benchmark:** Median or mean across all reporting trusts

Our `fact_ae_activity` table supports all these comparisons through dimensional slicing.

### Performance Trajectory

Trajectory analysis asks: **Is performance getting better or worse, and at what rate?**

```sql
-- Simple trajectory: 3-month rolling average vs prior 3-month rolling average
SELECT 
    trust_code,
    period,
    AVG(performance_pct) OVER (
        PARTITION BY trust_code 
        ORDER BY period_date 
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS rolling_3m_avg,
    LAG(AVG(performance_pct) OVER (
        PARTITION BY trust_code 
        ORDER BY period_date 
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ), 3) OVER (PARTITION BY trust_code ORDER BY period_date) AS prior_3m_avg
FROM fact_ae_activity
```

---

## 9. Winter Pressure Planning

### The Problem

Between November and February, NHS emergency departments experience:

| Pressure Factor | Typical Magnitude |
|----------------|------------------|
| Attendance increase vs summer | +15–25% |
| Admission rate increase | +3–5 percentage points |
| Bed occupancy | 95–100% (dangerously high) |
| Average length of stay | +5–10% longer |
| Staff sickness | 8–12% of workforce |
| Ambulance handover delays | Increasing significantly |
| 4-hour performance | -5 to -10 percentage points vs summer |

### Why Winter Is Different — Root Causes

| Clinical Factor | Operational Impact |
|----------------|-------------------|
| Respiratory illnesses (flu, RSV, COVID) | More patients with high acuity requiring admission |
| Falls in elderly patients | Increased orthopaedic and medical admissions |
| Hypothermia and cold-related illness | Increased older adult admissions |
| Mental health crises | Increased Type 1 attendance from vulnerable populations |
| Reduced GP availability over bank holidays | Patients default to A&E instead |
| Reduced social care capacity over Christmas | Delayed discharge blocks hospital beds |
| Norovirus spread | Staff sickness increases; hospital infection controls restrict capacity |

### Historical Trend Patterns in A&E Data

```
Annual Attendance Pattern (illustrative monthly index, England total):

     Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
      ↑    ↑    ↔    ↓    ↓    ↓    ↓    ↓    ↔    ↑    ↑    ↑↑
     High       Avg       Lower Season       Avg       High  Peak

4-Hour Performance (inverse of above):
Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
 ↓    ↓    ↔    ↑    ↑    ↑    ↑    ↑    ↔    ↓    ↓    ↓↓
Poor      Avg       Better Season         Avg      Poor  Worst
```

**Engineering implication:** Our `dim_month` dimension includes a season flag and financial year quarter. Year-on-year comparisons in Power BI must use same-month comparisons, not month-on-month.

### Data-Driven Winter Planning Outputs

Our platform supports winter planning through:

1. **Historical winter performance by trust** — last 5 years of Nov–Feb data
2. **Attendance demand forecasting** — projection based on historical seasonal patterns
3. **Capacity gap identification** — trusts historically furthest below target in winter
4. **Peer winter comparison** — how does a trust compare to similar trusts in winter?
5. **Early warning indicators** — detecting deteriorating trends in September/October before winter peaks

### NHS Operational Escalation Framework (OPEL)

NHS trusts declare an Operational Pressures Escalation Level (OPEL):

| OPEL Level | Description | A&E Trigger Points |
|------------|-------------|-------------------|
| **OPEL 1** | Elevated pressure but manageable | Attendances above average; 4-hour performance dipping |
| **OPEL 2** | High pressure requiring action | Performance declining; beds above 90% occupancy |
| **OPEL 3** | Severe pressure; systemic risk | Significant 4-hour breaches; ambulance delays; corridor care occurring |
| **OPEL 4** | Critical incident; system failure | Unable to maintain safe care; mutual aid required from other trusts |

Our Operational Command Center dashboard includes OPEL-aligned indicators — even though OPEL status itself is not in this dataset, the performance metrics we track are the inputs into OPEL assessment.

---

## 10. Business Glossary

Complete A-to-Z reference for all terms used in this project.

| Term | Definition | First Used In |
|------|-----------|---------------|
| **4-Hour Breach** | An A&E attendance where the patient waited more than 4 hours from registration to discharge/admission/transfer | Phase 1 |
| **4-Hour Standard** | NHS target that 95% of A&E patients should be admitted, discharged, or transferred within 4 hours of arrival | Phase 1 |
| **12-Hour Breach** | An attendance where the patient waited more than 12 hours (either from arrival, or from Decision to Admit) | Phase 1 |
| **Admission Conversion Rate** | Percentage of A&E attendances that result in emergency admission; calculated as Emergency Admissions ÷ Total Attendances × 100 | Phase 1 |
| **A&E** | Accident and Emergency — NHS emergency department providing immediate care for urgent and life-threatening conditions | Phase 1 |
| **Attendance** | A single patient visit to an A&E department, counted from registration | Phase 1 |
| **Boarding** | When a patient who has received a Decision to Admit remains in A&E waiting for an inpatient bed to become available | Phase 1 |
| **Bed Occupancy** | Percentage of available hospital beds currently occupied by inpatients; safe level considered ~85%; NHS typically operates at 92–95% | Phase 1 |
| **CCG** | Clinical Commissioning Group — predecessor to ICBs, abolished July 2022 | Phase 1 |
| **Clock Start** | The moment an A&E patient registers; the point from which the 4-hour clock begins | Phase 1 |
| **Clock Stop** | The moment a patient is discharged, admitted, or transferred; the point at which the 4-hour measurement ends | Phase 1 |
| **Commissioning** | The NHS process of planning, purchasing, and monitoring healthcare services for a defined population | Phase 1 |
| **DTA** | Decision to Admit — the clinical decision that a patient requires inpatient care; relevant to 12-hour DTA breaches | Phase 1 |
| **ECDS** | Emergency Care Data Set — a richer, more granular A&E dataset published separately; planned Phase 12 enhancement | Phase 12 |
| **Elective Admission** | A planned hospital admission scheduled in advance | Phase 1 |
| **Emergency Admission** | An unplanned hospital admission, typically following an acute illness or injury | Phase 1 |
| **Foundation Trust** | An NHS trust with greater financial and operational independence, governed partly by elected governors | Phase 1 |
| **ICB** | Integrated Care Board — one of 42 statutory NHS commissioning organisations in England; replaced CCGs in July 2022 | Phase 1 |
| **LBBS** | Left Before Being Seen — a patient who leaves A&E before clinical assessment; counted as an attendance | Phase 1 |
| **NHS Trust** | An NHS organisation that delivers healthcare services; the primary reporting unit in the A&E dataset | Phase 1 |
| **ODS** | Organisation Data Service — NHS England service managing unique codes for all NHS organisations | Phase 1 |
| **ODS Code** | Unique 3–5 character identifier assigned to each NHS organisation (e.g., RJ1 = Guy's and St Thomas') | Phase 1 |
| **OPEL** | Operational Pressures Escalation Level — 4-level framework (1–4) for NHS organisations to declare system pressure | Phase 1 |
| **Provider** | In NHS context, an organisation that delivers healthcare services (as distinct from a commissioner that purchases services) | Phase 1 |
| **Publication Period** | The calendar month to which a statistical release refers (distinct from the month in which it is published) | Phase 1 |
| **RAG** | Red/Amber/Green — a performance classification system; Red = poor, Amber = moderate, Green = acceptable | Phase 1 |
| **Revision** | A correction to a previously published statistical release; issued when trust data is corrected post-publication | Phase 1 |
| **SCD** | Slowly Changing Dimension — a data warehousing technique for tracking changes in reference data over time (covered in Phase 6) | Phase 6 |
| **Surge Capacity** | Additional beds, staff, or facilities activated during high-pressure periods (typically winter) | Phase 1 |
| **Timeseries** | A historical data file covering multiple consecutive reporting periods; used for bulk historical load | Phase 1 |
| **Triage** | The initial clinical assessment process that categorises patients by urgency; happens shortly after registration | Phase 1 |
| **Trust Merger** | When two or more NHS trusts combine into a single organisation; creates a complex data continuity challenge | Phase 1 |
| **Type 1 A&E** | Major emergency department — consultant-led, 24/7 operation, full resuscitation facilities; highest clinical complexity | Phase 1 |
| **Type 2 A&E** | Single-specialty emergency department — consultant-led but covering one clinical specialty only | Phase 1 |
| **Type 3 A&E** | Minor injury unit or urgent treatment centre — typically nurse-led, lower acuity | Phase 1 |
| **UTC** | Urgent Treatment Centre — a type of Type 3 facility providing care for minor injuries and illnesses | Phase 1 |
| **Winter Pressures** | The seasonal surge in emergency care demand occurring November–February each year | Phase 1 |
| **Year-on-Year (YoY)** | Comparison of a metric in the current period with the equivalent period 12 months prior; preferred for seasonal adjustment | Phase 1 |

---

## 11. KPI Glossary

Full definitions of every KPI calculated in this platform, with business logic and SQL.

---

### KPI-01: Total A&E Attendances

| Attribute | Value |
|-----------|-------|
| **Definition** | Total number of patient visits across all A&E department types in a reporting period |
| **Grain** | Trust × Month |
| **Calculation** | `SUM(type1_attendances + type2_attendances + type3_attendances)` |
| **Target** | No direct target; monitored for volume trends |
| **Business Use** | Demand monitoring, capacity planning, year-on-year trend analysis |
| **Dashboard** | National Trends, Provider Rankings, Operational Command Center |

```sql
SELECT 
    p.trust_code,
    p.trust_name,
    m.period_label,
    SUM(f.type1_attendances + f.type2_attendances + f.type3_attendances) AS total_attendances
FROM fact_ae_activity f
JOIN dim_provider p ON f.provider_key = p.provider_key
JOIN dim_month m ON f.month_key = m.month_key
GROUP BY p.trust_code, p.trust_name, m.period_label
ORDER BY m.period_date, total_attendances DESC;
```

---

### KPI-02: Type 1 Attendances

| Attribute | Value |
|-----------|-------|
| **Definition** | Attendances at major (consultant-led) A&E departments only |
| **Grain** | Trust × Month |
| **Calculation** | `SUM(type1_attendances)` |
| **Business Use** | Primary performance measure — most clinically significant attendances |
| **Dashboard** | National Trends, Provider Rankings |

---

### KPI-03: Emergency Admissions via A&E

| Attribute | Value |
|-----------|-------|
| **Definition** | Total patients admitted to hospital as inpatients following an A&E attendance (all types combined) |
| **Grain** | Trust × Month |
| **Calculation** | `SUM(type1_admissions + type2_admissions + type3_admissions)` |
| **Business Use** | Capacity planning, bed management, acuity monitoring |
| **Dashboard** | Emergency Admissions, Operational Command Center |

---

### KPI-04: Admission Conversion Rate

| Attribute | Value |
|-----------|-------|
| **Definition** | Proportion of A&E attendances resulting in emergency admission; proxy for patient acuity |
| **Grain** | Trust × Month |
| **Calculation** | `emergency_admissions / total_attendances * 100` |
| **Normal Range** | 25–35% for Type 1 departments |
| **Interpretation** | Higher = sicker patient population; lower = higher proportion of self-resolving cases |
| **Business Use** | Acuity monitoring, bed pressure indicator, winter readiness planning |
| **Dashboard** | Emergency Admissions, Provider Rankings |

```sql
SELECT
    trust_code,
    period_label,
    ROUND(
        (type1_admissions + type2_admissions + type3_admissions)::numeric /
        NULLIF((type1_attendances + type2_attendances + type3_attendances), 0) * 100,
    1) AS admission_conversion_rate_pct
FROM fact_ae_activity f
JOIN dim_provider p USING (provider_key)
JOIN dim_month m USING (month_key);
```

---

### KPI-05: 4-Hour Performance Rate (All Types)

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage of A&E attendances where patient was admitted, discharged, or transferred within 4 hours |
| **Grain** | Trust × Month |
| **Calculation** | `(total_attendances - attendances_gt_4hrs) / total_attendances * 100` |
| **Legacy Target** | 95% (pre-2023) |
| **Interim Target** | 76% Type 1 (2023 onwards) |
| **Business Use** | Primary waiting-time performance metric; the most scrutinised KPI in NHS emergency care |
| **Dashboard** | All dashboards |

```sql
SELECT
    trust_code,
    period_label,
    total_attendances,
    total_attendances_gt_4hrs,
    total_attendances - total_attendances_gt_4hrs AS attendances_within_4hrs,
    ROUND(
        (total_attendances - total_attendances_gt_4hrs)::numeric /
        NULLIF(total_attendances, 0) * 100,
    1) AS performance_pct
FROM fact_ae_activity f
JOIN dim_provider p USING (provider_key)
JOIN dim_month m USING (month_key);
```

---

### KPI-06: 4-Hour Performance — Type 1 Only

| Attribute | Value |
|-----------|-------|
| **Definition** | 4-hour performance calculated only for Type 1 (major) A&E departments |
| **Grain** | Trust × Month |
| **Calculation** | `(type1_attendances - type1_attendances_gt_4hrs) / type1_attendances * 100` |
| **Interim Target** | 76% |
| **Business Use** | Current primary NHS performance metric; most scrutinised by NHS England |

---

### KPI-07: Attendances >4 Hours (Breach Count)

| Attribute | Value |
|-----------|-------|
| **Definition** | Absolute number of attendances where the patient waited more than 4 hours |
| **Grain** | Trust × Month |
| **Calculation** | `SUM(attendances_gt_4hrs_type1 + attendances_gt_4hrs_type23)` |
| **Business Use** | Volume of breaches (complements rate); important for absolute patient harm assessment |

---

### KPI-08: Year-on-Year Attendance Change (%)

| Attribute | Value |
|-----------|-------|
| **Definition** | Percentage change in total attendances vs. the same month in the prior year |
| **Grain** | Trust × Month |
| **Calculation** | `(current_month - same_month_prior_year) / same_month_prior_year * 100` |
| **Business Use** | Demand trend analysis; removes seasonal distortion from MoM comparisons |
| **Dashboard** | National Trends |

```sql
SELECT
    trust_code,
    period_label,
    total_attendances AS current_period_attendances,
    LAG(total_attendances, 12) OVER (
        PARTITION BY trust_code 
        ORDER BY period_date
    ) AS prior_year_attendances,
    ROUND(
        (total_attendances - LAG(total_attendances, 12) OVER (
            PARTITION BY trust_code ORDER BY period_date
        ))::numeric / 
        NULLIF(LAG(total_attendances, 12) OVER (
            PARTITION BY trust_code ORDER BY period_date
        ), 0) * 100,
    1) AS yoy_change_pct
FROM fact_ae_activity f
JOIN dim_provider p USING (provider_key)
JOIN dim_month m USING (month_key);
```

---

### KPI-09: Provider Ranking by 4-Hour Performance

| Attribute | Value |
|-----------|-------|
| **Definition** | Trust-level ranking from best to worst 4-hour performance in a given period |
| **Grain** | Trust × Month |
| **Calculation** | `RANK() OVER (PARTITION BY period ORDER BY performance_pct DESC)` |
| **Business Use** | Peer comparison; outlier identification; performance league table |
| **Dashboard** | Provider Rankings |

```sql
SELECT
    trust_code,
    trust_name,
    period_label,
    performance_pct,
    RANK() OVER (
        PARTITION BY period_date 
        ORDER BY performance_pct DESC
    ) AS national_rank,
    COUNT(*) OVER (PARTITION BY period_date) AS total_providers
FROM fact_ae_activity f
JOIN dim_provider p USING (provider_key)
JOIN dim_month m USING (month_key)
WHERE total_attendances > 0;
```

---

### KPI-10: ICB Aggregate Performance

| Attribute | Value |
|-----------|-------|
| **Definition** | 4-hour performance aggregated to ICB level, weighted by attendance volume |
| **Grain** | ICB × Month |
| **Calculation** | `SUM(attendances_within_4hrs) / SUM(total_attendances) * 100` (weighted) |
| **Business Use** | System-level performance monitoring; ICB commissioner oversight |
| **Dashboard** | National Trends, Operational Command Center |

```sql
SELECT
    p.icb_code,
    p.icb_name,
    m.period_label,
    SUM(f.total_attendances) AS icb_total_attendances,
    SUM(f.total_attendances - f.total_attendances_gt_4hrs) AS icb_within_4hrs,
    ROUND(
        SUM(f.total_attendances - f.total_attendances_gt_4hrs)::numeric /
        NULLIF(SUM(f.total_attendances), 0) * 100,
    1) AS icb_performance_pct
FROM fact_ae_activity f
JOIN dim_provider p USING (provider_key)
JOIN dim_month m USING (month_key)
GROUP BY p.icb_code, p.icb_name, m.period_label, m.period_date
ORDER BY m.period_date, icb_performance_pct DESC;
```

---

### KPI-11: Type 3 Share of Total Attendances

| Attribute | Value |
|-----------|-------|
| **Definition** | Minor injury unit attendances as a proportion of all attendances |
| **Grain** | Trust × Month |
| **Calculation** | `type3_attendances / total_attendances * 100` |
| **Business Use** | Monitoring deflection of lower-acuity patients; UTC capacity planning |

---

### KPI-12: National Median 4-Hour Performance

| Attribute | Value |
|-----------|-------|
| **Definition** | Median 4-hour performance rate across all trusts in a given period |
| **Grain** | Month (national) |
| **Calculation** | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY performance_pct)` |
| **Business Use** | Benchmark for individual trust comparison |

```sql
SELECT
    period_label,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY performance_pct)::numeric, 1) AS median_performance_pct,
    ROUND(AVG(performance_pct)::numeric, 1) AS mean_performance_pct,
    ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY performance_pct)::numeric, 1) AS p25_performance_pct,
    ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY performance_pct)::numeric, 1) AS p75_performance_pct
FROM fact_ae_activity f
JOIN dim_month m USING (month_key)
WHERE total_attendances > 500  -- exclude very small/inactive trusts
GROUP BY period_label, period_date
ORDER BY period_date;
```

---

## 12. Operational Reporting Concepts for Engineers

This section bridges healthcare domain knowledge and data engineering concepts. It explains the reporting patterns you will encounter and how they translate into engineering design decisions.

### Concept 1: Why the Timeseries File Matters More Than Monthly Files

NHS England publishes:
- **Monthly files:** One file per month, current data only
- **Timeseries files:** One consolidated file covering all historical months

For building a data warehouse, the timeseries file is gold. It means:
- A single download gives you the complete historical dataset
- No need to archive individual monthly files for historical load
- Format is consistent across the entire history

**However,** the timeseries file is typically published weeks behind the monthly file. So for the most current month, you need the monthly file.

Our ingestion strategy:
1. First load: Download and process the timeseries file (full historical load)
2. Ongoing: Download and process new monthly files as published
3. Revision handling: Re-download timeseries periodically to catch revisions to historical months

### Concept 2: Seasonal Comparisons — Why MoM Misleads

```
If you compare July performance to December performance:
  July performance: 82%
  December performance: 71%
  Month-on-month change: -11 percentage points

This looks terrible. But...

  December prior year performance: 73%
  Year-on-year change: -2 percentage points

Year-on-year comparison reveals the true underlying trend.
Month-on-month comparison is contaminated by seasonal effects.
```

**Engineering implication:** Our `dim_month` table stores `prior_year_period_date` as a pre-calculated attribute, enabling efficient year-on-year joins in Power BI without complex DAX time intelligence.

### Concept 3: The Revision Detection Problem

The same month can be published multiple times as NHS England issues corrections.

Our solution uses a **file hash approach**:
1. When we download a file, we compute its SHA-256 hash
2. We store the hash in a `raw_file_metadata` table
3. Every time our pipeline runs, it checks the current hash of the published file vs. the stored hash
4. If hashes differ, the file has been revised — we trigger a re-ingestion workflow

### Concept 4: Reconciliation Against Published Totals

NHS England publishes national aggregate totals in each release. Our calculated totals must match.

After every ingestion:
```sql
-- Check our calculated national total matches the published total
SELECT 
    m.period_label,
    SUM(f.total_attendances) AS our_calculated_total,
    pt.published_national_total,
    SUM(f.total_attendances) - pt.published_national_total AS variance,
    CASE WHEN ABS(SUM(f.total_attendances) - pt.published_national_total) <= 10 
         THEN 'PASS' ELSE 'FAIL' END AS reconciliation_status
FROM fact_ae_activity f
JOIN dim_month m USING (month_key)
JOIN published_totals pt USING (month_key)
GROUP BY m.period_label, pt.published_national_total;
```

Small variances (≤10) are acceptable due to rounding in the source file. Large variances indicate a data loading error.

### Concept 5: Handling Missing Data Gracefully

Not every trust submits every month. Our data quality rules:

- **Missing attendance values:** Store as NULL (not 0) — zero and "did not report" are different
- **Partial month submissions:** Flag as `is_partial_submission = true` in staging
- **Zero attendances:** Legitimate for trusts that have temporarily closed a department
- **Implausibly low values:** Flag for human review via Great Expectations

**In KPI calculations, always use NULLIF to handle missing denominators:**
```sql
-- Never divide without protecting against zero/null denominators
ROUND(
    numerator::numeric / NULLIF(denominator, 0) * 100, 
1) AS safe_percentage
```

### Concept 6: The Financial Year Dimension

NHS England reports performance against its financial year (April–March):

| Financial Year | Calendar Coverage |
|---------------|------------------|
| FY 2024/25 | April 2024 – March 2025 |
| FY 2023/24 | April 2023 – March 2024 |

All year-to-date calculations must align with the NHS financial year, not the calendar year.

Our `dim_month` table stores:
- `financial_year` (e.g., "2024/25")
- `financial_quarter` (Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar)
- `financial_year_month_number` (1=April, 2=May, ... 12=March)
- `is_winter_month` (flag for November–February)

### Concept 7: Schema Drift Detection

NHS England occasionally changes column names, sheet names, or adds new columns to the XLS file. Our ingestion layer must detect this.

Schema drift detection approach:
1. Parse the XLS header row before processing
2. Compare parsed column names against expected column names (stored in a schema registry)
3. If mismatch detected: halt ingestion, log alert, notify via email/Slack
4. Manual review of schema changes before updating the ingestion mapping

This prevents silent failures where data loads into wrong columns.

---

## Phase 1 Complete

### Summary

You now have a solid foundation in:
- How A&E operational data is produced, published, and used
- What every KPI measures, why it matters, and how to calculate it
- The organisational structure (Trusts → ICBs → Regions → National)
- The engineering challenges unique to NHS data (revisions, mergers, seasonality, type mix)
- The business context that makes this data professionally significant

### What to Learn Before Phase 2

| Topic | Resource | Why It Matters |
|-------|----------|----------------|
| NHS Digital publications | england.nhs.uk/statistics | Understanding the actual data you'll ingest |
| Excel/XLS file structure | Python openpyxl documentation | The source data is in XLS format |
| NHS ODS | digital.nhs.uk/ods | Maintaining provider reference data |
| NHS financial year | Any NHS trust annual report | Understanding year-to-date calculations |

### Phase 2 Preview

Phase 2 covers:
- Downloading and analysing the actual NHS England A&E dataset
- Understanding the XLS file structure and sheet layout
- Building a metadata catalog and data dictionary
- Designing a revision management strategy
- Creating a source-to-target mapping

---

*Document: Phase 1 of 13 | NHS A&E Analytics Platform | Version 1.0*
