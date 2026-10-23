// Zoznamy zo starého Zdravka (assets/*.json): podtypy udalostí, účinné látky a dávkovanie.
// Vygenerované z family_mobile_app/assets – podtyp sa ukladá ako názov (ako v mobilnom Zdravkovi).
window.ZDRAVKO_DATA = {
 "subtypes": {
  "doctor_visit": [
   "Pediatrička / pediater",
   "Praktický lekár",
   "Internista",
   "Geriater",
   "Kardiológ",
   "Endokrinológ",
   "Diabetológ",
   "Gastroenterológ",
   "Hematológ",
   "Nefrológ",
   "Reumatológ",
   "Pneumológ",
   "Infektológ",
   "Alergológ / Imunológ",
   "Neurológ",
   "Psychiater",
   "Psychológ",
   "Gynekológ",
   "Urológ",
   "Dermatológ",
   "Oftalmológ",
   "ORL lekár",
   "Chirurg",
   "Ortopéd",
   "Cievny chirurg",
   "Plastický chirurg",
   "Neurochirurg",
   "Onkológ",
   "Rádiológ",
   "Rehabilitačný lekár / Fyziater",
   "Anesteziológ",
   "Pracovné lekárstvo",
   "Telovýchovný lekár",
   "Neonatológ",
   "Zubný lekár / Stomatológ",
   "Iné"
  ],
  "examination": [
   "Všeobecná prehliadka",
   "Preventívna prehliadka dieťaťa",
   "Vyšetrenie novorodenca",
   "Sledovanie rastu a vývoja dieťaťa",
   "Očkovanie",
   "Povinné očkovanie",
   "Nepovinné očkovanie",
   "Lekárska prehliadka do školy / škôlky",
   "Športová prehliadka (dieťa)",
   "Športová prehliadka (dospelý)",
   "Krvné testy",
   "Močové testy",
   "PSA test",
   "Tehotenský test",
   "Test na COVID-19",
   "Ultrazvuk",
   "Ultrazvuk kĺbov",
   "Ultrazvuk bedier (dojča)",
   "Prenatálny ultrazvuk",
   "RTG vyšetrenie",
   "CT vyšetrenie",
   "MRI vyšetrenie",
   "Mamografia",
   "Denzitometria (DEXA)",
   "EKG",
   "Echo srdca",
   "Holter EKG",
   "Holter tlaku krvi",
   "Záťažové EKG",
   "Echo srdca (dieťa)",
   "Spirometria",
   "Spirometria (dieťa)",
   "Endoskopia",
   "Gastroskopia",
   "Koloskopia",
   "Rektoskopia",
   "Dermatoskopia",
   "Biopsia",
   "Oftalmoskopia",
   "Audiometria",
   "Tympanometria",
   "Laryngoskopia",
   "EMG vyšetrenie",
   "EEG vyšetrenie",
   "Gynekologické vyšetrenie",
   "Cytológia (PAP test)",
   "Vyšetrenie prostaty",
   "Alergologické testy",
   "Iné"
  ],
  "vaccination": [
   "DPT (záškrt, tetanus, čierny kašeľ)",
   "Polio (detská obrna)",
   "Hib (Haemophilus influenzae typ b)",
   "Pneumokoková vakcína",
   "Rotavírusová vakcína",
   "MMR (osýpky, príušnice, ružienka)",
   "Ovčie kiahne",
   "Hepatitída A",
   "Hepatitída B",
   "HPV (ľudský papilomavírus)",
   "Meningokoková vakcína",
   "Tetanol (záškrt, tetanus)",
   "Čierny kašeľ (dospelí)",
   "Chrípka (sezónna)",
   "COVID-19",
   "Besnota",
   "Týfus",
   "Žltá zimnica",
   "Japonská encefalitída",
   "Iné"
  ]
 },
 "substances": [
  {
   "id": "ibuprofen",
   "name": "Ibuprofen"
  },
  {
   "id": "paracetamol",
   "name": "Paracetamol"
  },
  {
   "id": "acetylsalicylic_acid",
   "name": "Kyselina acetylsalicylová"
  }
 ],
 "dosages": {
  "ibuprofen": {
   "name": "Ibuprofen",
   "brands": [
    "Ibalgin",
    "Nurofen",
    "Brufen"
   ],
   "forms": {
    "syrup": {
     "name": "Sirup",
     "description": "Tekutý sirup na požitie",
     "concentrations": [
      {
       "value": 20,
       "unit": "mg/ml"
      },
      {
       "value": 40,
       "unit": "mg/ml"
      }
     ]
    },
    "suppositories": {
     "name": "Čípky",
     "description": "Rekálne čípky",
     "concentrations": [
      {
       "value": 60,
       "unit": "mg",
       "weightBasedDosages": [
        {
         "minWeight": 6,
         "maxWeight": 12,
         "dose": 1,
         "unit": "čípok"
        }
       ]
      },
      {
       "value": 125,
       "unit": "mg",
       "weightBasedDosages": [
        {
         "minWeight": 12,
         "maxWeight": 17,
         "dose": 1,
         "unit": "čípok"
        }
       ]
      }
     ]
    },
    "tablets": {
     "name": "Tablety",
     "description": "Tablety na požitie",
     "concentrations": [
      {
       "value": 200,
       "unit": "mg",
       "weightBasedDosages": [
        {
         "minWeight": 15,
         "maxWeight": 35,
         "dose": 1,
         "unit": "tabletka (200mg)"
        }
       ]
      },
      {
       "value": 400,
       "unit": "mg",
       "weightBasedDosages": [
        {
         "minWeight": 35,
         "maxWeight": 999,
         "dose": 1,
         "unit": "tabletka (400mg)"
        }
       ]
      }
     ]
    }
   }
  },
  "paracetamol": {
   "name": "Paracetamol",
   "interval": "Minimálny interval medzi dávkami je 6 hodín",
   "brands": [
    "Panadol",
    "Paralen",
    "Coldrex",
    "Medipirin"
   ],
   "forms": {
    "syrup": {
     "name": "Sirup",
     "description": "Tekutý sirup na požitie",
     "concentrations": [
      {
       "value": 24,
       "unit": "mg/ml"
      },
      {
       "value": 50,
       "unit": "mg/ml"
      },
      {
       "value": 100,
       "unit": "mg/ml"
      }
     ]
    },
    "suppositories": {
     "name": "Čípky",
     "description": "Rekálne čípky",
     "weightBasedDosages": [
      {
       "minWeight": 4,
       "maxWeight": 5,
       "dose": 0.5,
       "unit": "čípku"
      },
      {
       "minWeight": 6,
       "maxWeight": 7,
       "dose": 0.75,
       "unit": "čípku"
      },
      {
       "minWeight": 7,
       "maxWeight": 10,
       "dose": 1,
       "unit": "čípok"
      },
      {
       "minWeight": 11,
       "maxWeight": 14,
       "dose": 1.5,
       "unit": "čípku"
      }
     ]
    },
    "tablets": {
     "name": "Tablety",
     "description": "Tablety na požitie",
     "concentrations": [
      {
       "value": 125,
       "unit": "mg",
       "weightBasedDosages": [
        {
         "minWeight": 9,
         "maxWeight": 12,
         "dose": 1,
         "unit": "tabletka (125mg)"
        },
        {
         "minWeight": 13,
         "maxWeight": 16,
         "dose": 1.5,
         "unit": "tabletky (125mg)"
        },
        {
         "minWeight": 17,
         "maxWeight": 20,
         "dose": 2,
         "unit": "tabletky (125mg)"
        }
       ]
      },
      {
       "value": 500,
       "unit": "mg",
       "weightBasedDosages": [
        {
         "minWeight": 17,
         "maxWeight": 20,
         "dose": 0.5,
         "unit": "tabletka (500mg)"
        },
        {
         "minWeight": 21,
         "maxWeight": 32,
         "dose": 0.75,
         "unit": "tabletky (500mg)"
        },
        {
         "minWeight": 33,
         "maxWeight": 999,
         "dose": 1,
         "unit": "tabletka (500mg)"
        }
       ]
      }
     ]
    }
   }
  }
 }
};
