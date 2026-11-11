// A table made up for this page so that it is never empty. It is NOT a network measurement and the page says so.
// Produced by running the contract's own metrics (tests/direct) on invented answers.
export default {
 "drift_cells": null,
 "id": "976df62ae598c0a1c04a07a325d5aa5e54a6697b001e357353317e68f1fcb2b3",
 "pack": {
  "cases": [
   {
    "intent": "COMPLIES",
    "text": "Buyer returned an unopened item 3 days after delivery."
   },
   {
    "intent": "COMPLIES",
    "text": "Buyer returned the item 12 days after delivery, unused."
   },
   {
    "intent": "COMPLIES",
    "text": "Buyer returned the item 20 days after delivery, in the original box."
   },
   {
    "intent": "VIOLATES",
    "text": "Buyer returned the item 31 days after delivery, unused."
   },
   {
    "intent": "VIOLATES",
    "text": "Buyer returned the item 90 days after delivery."
   },
   {
    "intent": "VIOLATES",
    "text": "Buyer returned a visibly worn item 5 days after delivery."
   },
   {
    "intent": "VIOLATES",
    "text": "Buyer sent only a photo of the item 2 days after delivery and kept the item."
   },
   {
    "intent": "OPEN",
    "text": "Buyer returned the item 34 days after delivery because the carrier lost the first parcel."
   }
  ],
  "label": "Refund rule v1 (vague)",
  "previous": "",
  "wordings": [
   "Approve a refund when the item was returned within a reasonable time after delivery.",
   "A refund is valid only if the buyer sent the item back soon after receiving it.",
   "Refunds are granted for items that were returned promptly.",
   "The buyer may get a refund provided the return happened in good time and the item is in acceptable condition."
  ]
 },
 "report": {
  "alignment_permille": [
   857,
   714,
   428,
   1000
  ],
  "best_tied": false,
  "best_wording": 3,
  "boundary": [
   1,
   2,
   3,
   5,
   7
  ],
  "cases": 8,
  "consistency_permille": 625,
  "fidelity_permille": 714,
  "grade": "SHAKY",
  "per_case": [
   {
    "class": "UNANIMOUS",
    "counts": {
     "C": 4,
     "U": 0,
     "V": 0
    },
    "index": 0,
    "majority": "C",
    "off_intent": false
   },
   {
    "class": "MAJORITY",
    "counts": {
     "C": 3,
     "U": 0,
     "V": 1
    },
    "index": 1,
    "majority": "C",
    "off_intent": false
   },
   {
    "class": "SPLIT",
    "counts": {
     "C": 2,
     "U": 0,
     "V": 2
    },
    "index": 2,
    "majority": "",
    "off_intent": true
   },
   {
    "class": "MAJORITY",
    "counts": {
     "C": 1,
     "U": 0,
     "V": 3
    },
    "index": 3,
    "majority": "V",
    "off_intent": false
   },
   {
    "class": "UNANIMOUS",
    "counts": {
     "C": 0,
     "U": 0,
     "V": 4
    },
    "index": 4,
    "majority": "V",
    "off_intent": false
   },
   {
    "class": "MAJORITY",
    "counts": {
     "C": 3,
     "U": 0,
     "V": 1
    },
    "index": 5,
    "majority": "C",
    "off_intent": true
   },
   {
    "class": "UNANIMOUS",
    "counts": {
     "C": 0,
     "U": 0,
     "V": 4
    },
    "index": 6,
    "majority": "V",
    "off_intent": false
   },
   {
    "class": "SPLIT",
    "counts": {
     "C": 1,
     "U": 2,
     "V": 1
    },
    "index": 7,
    "majority": "",
    "off_intent": false
   }
  ],
  "score_permille": 625,
  "wordings": 4
 },
 "runs": [
  {
   "at": 0,
   "by": "sample",
   "rows": [
    "CCCVVCVU",
    "CCVVVCVV",
    "CVVCVCVU",
    "CCCVVVVC"
   ]
  }
 ]
};
