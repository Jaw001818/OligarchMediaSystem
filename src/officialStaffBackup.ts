import { Employee } from "./types";

export const OFFICIAL_STAFF_ROSTER: Employee[] = ([
  {
    "shiftEnd": "07:00",
    "scheduleNotes": "Weekly Work Schedule",
    "lastName": "GLORIOSO",
    "position": "Graphic Designer",
    "isAdmin": false,
    "allowance": 3000,
    "profilePicture": "data:image/jpeg;base64,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",
    "email": "jericho.oligarchmedia@gmail.com",
    "salary": 12000,
    "status": "Active",
    "pin": "0521",
    "employeeNumber": "010",
    "scheduleOverride": {
      "workHourEnd": "07:00",
      "updatedAt": 1793627479110,
      "isRestDay": false,
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "breakDurationMinutes": 60,
      "date": "2026-11-02",
      "reason": "",
      "workHourStart": "22:00",
      "requiredHours": 8,
      "updatedBy": "Admin"
    },
    "workHourEnd": "07:00",
    "phone": "",
    "workHourStart": "22:00",
    "fullName": "GLORIOSO, JERICHO D",
    "id": "0BfjkTsnA6n8HjXDm4CP",
    "shiftStart": "22:00",
    "department": "Graphic Design",
    "weeklySchedule": {
      "wednesday": {
        "notes": "Regular Shift",
        "requiredHours": 8,
        "isRestDay": false,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "day": "wednesday",
        "breakDurationMinutes": 60
      },
      "thursday": {
        "workHourEnd": "07:00",
        "notes": "Regular Shift",
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "requiredHours": 8,
        "day": "thursday",
        "isRestDay": false
      },
      "tuesday": {
        "day": "tuesday",
        "notes": "Regular Shift",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "isRestDay": false
      },
      "friday": {
        "workHourStart": "22:00",
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "day": "friday",
        "notes": "Regular Shift",
        "breakDurationMinutes": 60,
        "isRestDay": false
      },
      "sunday": {
        "isRestDay": true,
        "notes": "Rest Day",
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "day": "sunday",
        "requiredHours": 8,
        "breakDurationMinutes": 60
      },
      "saturday": {
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "notes": "Regular Shift",
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "isRestDay": false,
        "day": "saturday"
      },
      "monday": {
        "breakDurationMinutes": 60,
        "notes": "Regular Shift",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "day": "monday",
        "workHourStart": "22:00"
      }
    },
    "requiredHours": 8,
    "updatedAt": 1793627051343,
    "employmentType": "Full-time",
    "middleName": "D",
    "salaryHistory": [],
    "scheduleType": "custom",
    "birthday": "1995-01-01",
    "breakEnd": "04:00",
    "breakStart": "03:00",
    "dailyRate": 600,
    "schedule": {
      "saturday": {
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "requiredHours": 0,
        "workHourEnd": "07:00",
        "enabled": false,
        "breakStart": "03:00"
      },
      "tuesday": {
        "breakStart": "03:00",
        "workHourEnd": "07:00",
        "breakEnd": "04:00",
        "workHourStart": "22:00",
        "enabled": true,
        "requiredHours": 8
      },
      "monday": {
        "breakEnd": "04:00",
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "requiredHours": 8,
        "enabled": true,
        "workHourStart": "22:00"
      },
      "friday": {
        "enabled": true,
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "breakStart": "03:00",
        "breakEnd": "04:00"
      },
      "sunday": {
        "requiredHours": 0,
        "workHourStart": "22:00",
        "enabled": false,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "workHourEnd": "07:00"
      },
      "thursday": {
        "workHourStart": "22:00",
        "enabled": true,
        "requiredHours": 8,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "workHourEnd": "07:00"
      },
      "wednesday": {
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "requiredHours": 8,
        "workHourStart": "22:00",
        "enabled": true,
        "breakEnd": "04:00"
      }
    },
    "firstName": "JERICHO",
    "dateHired": "2025-11-21",
    "otRate": 75
  },
  {
    "middleName": "P",
    "firstName": "MARK DANIEL",
    "dateHired": "2025-03-24",
    "birthday": "2007-10-30",
    "phone": "",
    "department": "Graphic Design",
    "scheduleNotes": "Weekly Work Schedule",
    "dailyRate": 600,
    "workHourStart": "23:00",
    "scheduleType": "weekly",
    "updatedAt": 1792796354747,
    "weeklySchedule": {
      "friday": {
        "day": "friday",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "notes": "Night Shift (9PM–6AM)",
        "isRestDay": false,
        "workHourStart": "22:00"
      },
      "monday": {
        "workHourStart": "23:00",
        "workHourEnd": "08:00",
        "day": "monday",
        "requiredHours": 8,
        "notes": "Night Shift (11PM–8AM)",
        "breakDurationMinutes": 60,
        "isRestDay": false
      },
      "sunday": {
        "notes": "Rest Day",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "day": "sunday",
        "isRestDay": true
      },
      "thursday": {
        "workHourEnd": "08:00",
        "isRestDay": false,
        "day": "thursday",
        "workHourStart": "23:00",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "notes": "Night Shift (9PM–6AM)"
      },
      "wednesday": {
        "isRestDay": false,
        "breakDurationMinutes": 60,
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "notes": "Night Shift (9PM–6AM)",
        "day": "wednesday",
        "workHourStart": "22:00"
      },
      "tuesday": {
        "workHourStart": "23:00",
        "notes": "Night Shift (11PM–8AM)",
        "isRestDay": false,
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "workHourEnd": "08:00",
        "day": "tuesday"
      },
      "saturday": {
        "notes": "Night Shift (9PM–6AM)",
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "day": "saturday",
        "isRestDay": true
      }
    },
    "employmentType": "Full-time",
    "status": "Resigned",
    "email": "markdaniel.oligarchmediaph@gmail.com",
    "customWorkHourEnd": null,
    "salary": 12000,
    "workHourEnd": "08:00",
    "employeeNumber": "006",
    "requiredHours": 8,
    "salaryHistory": [],
    "fullName": "SANCHEZ, MARK DANIEL P",
    "id": "5YjbHH8Vn78bYsw1HUgF",
    "pin": "1030",
    "otRate": 75,
    "lastName": "SANCHEZ",
    "position": "Graphic Designer",
    "customWorkHourStart": null,
    "allowance": 3000,
    "profilePicture": "data:image/jpeg;base64,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",
    "isAdmin": false,
    "scheduleOverride": {
      "updatedAt": 1792594385289,
      "workHourStart": "23:00",
      "date": "2026-10-21",
      "breakDurationMinutes": 60,
      "notes": "11:00 PM – 8:00 AM Shift",
      "isRestDay": false,
      "reason": "11:00 PM – 8:00 AM Shift",
      "workHourEnd": "08:00",
      "requiredHours": 8,
      "updatedBy": "Admin"
    }
  },
  {
    "updatedAt": 1792685988455,
    "phone": "",
    "scheduleType": "weekly",
    "breakStart": "03:00",
    "otRate": 87.5,
    "isAdmin": false,
    "workHourStart": "22:00",
    "scheduleNotes": "Weekly Work Schedule",
    "birthday": "1995-01-01",
    "employmentType": "Full-time",
    "department": "Graphic Design",
    "breakEnd": "04:00",
    "dateHired": "2024-08-19",
    "firstName": "JOHN CEDRIC",
    "workHourEnd": "07:00",
    "weeklySchedule": {
      "tuesday": {
        "day": "tuesday",
        "notes": "Regular Shift",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "workHourStart": "22:00"
      },
      "saturday": {
        "requiredHours": 8,
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "workHourEnd": "07:00",
        "isRestDay": false,
        "day": "saturday",
        "notes": "Regular Shift"
      },
      "wednesday": {
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "notes": "Regular Shift",
        "day": "wednesday",
        "breakDurationMinutes": 60,
        "isRestDay": false
      },
      "thursday": {
        "day": "thursday",
        "breakDurationMinutes": 60,
        "notes": "Regular Shift",
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "requiredHours": 8,
        "isRestDay": false
      },
      "friday": {
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "notes": "Regular Shift",
        "day": "friday"
      },
      "monday": {
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "day": "monday",
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "notes": "Regular Shift"
      },
      "sunday": {
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "notes": "Rest Day",
        "day": "sunday",
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "isRestDay": true
      }
    },
    "schedule": {
      "wednesday": {
        "workHourStart": "22:00",
        "requiredHours": 8,
        "enabled": true,
        "workHourEnd": "07:00",
        "breakEnd": "04:00",
        "breakStart": "03:00"
      },
      "thursday": {
        "workHourStart": "22:00",
        "requiredHours": 8,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "enabled": true,
        "workHourEnd": "07:00"
      },
      "tuesday": {
        "workHourEnd": "07:00",
        "enabled": true,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "workHourStart": "22:00",
        "requiredHours": 8
      },
      "sunday": {
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "requiredHours": 0,
        "breakEnd": "04:00",
        "workHourEnd": "07:00",
        "enabled": false
      },
      "monday": {
        "workHourStart": "22:00",
        "enabled": true,
        "requiredHours": 8,
        "breakStart": "03:00",
        "workHourEnd": "07:00",
        "breakEnd": "04:00"
      },
      "friday": {
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "enabled": true
      },
      "saturday": {
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "requiredHours": 0,
        "enabled": false,
        "breakStart": "03:00",
        "workHourEnd": "07:00"
      }
    },
    "email": "cedrickroque20.oligarchmedia@gmail.com",
    "middleName": "M",
    "dailyRate": 700,
    "shiftEnd": "07:00",
    "allowance": 3000,
    "lastName": "ROQUE",
    "scheduleOverride": {
      "workHourStart": "22:00",
      "updatedBy": "Admin",
      "date": "2026-11-02",
      "requiredHours": 8,
      "updatedAt": 1793627494902,
      "workHourEnd": "07:00",
      "reason": "",
      "breakDurationMinutes": 60,
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "isRestDay": false
    },
    "position": "Graphic Designer",
    "shiftStart": "22:00",
    "employeeNumber": "005",
    "profilePicture": "data:image/jpeg;base64,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",
    "id": "7e4XtgzE9h9zS7OltU9O",
    "status": "Active",
    "salaryHistory": [],
    "salary": 14000,
    "fullName": "ROQUE, JOHN CEDRIC M",
    "requiredHours": 8,
    "pin": "0520"
  },
  {
    "scheduleNotes": "Weekly Work Schedule",
    "lastName": "LAXA",
    "position": "Graphic Designer",
    "email": "israel.oligarchmediaph@gmail.com",
    "shiftStart": "22:00",
    "updatedAt": 1792685993943,
    "shiftEnd": "07:00",
    "fullName": "LAXA, ISRAEL P",
    "weeklySchedule": {
      "wednesday": {
        "requiredHours": 8,
        "notes": "Regular Shift",
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "isRestDay": false,
        "breakDurationMinutes": 60,
        "day": "wednesday"
      },
      "thursday": {
        "breakDurationMinutes": 60,
        "day": "thursday",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "isRestDay": false,
        "notes": "Regular Shift"
      },
      "tuesday": {
        "workHourStart": "22:00",
        "notes": "Regular Shift",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "day": "tuesday",
        "isRestDay": false,
        "workHourEnd": "07:00"
      },
      "sunday": {
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "day": "sunday",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "isRestDay": true,
        "notes": "Rest Day"
      },
      "friday": {
        "day": "friday",
        "notes": "Regular Shift",
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "isRestDay": false
      },
      "monday": {
        "workHourEnd": "07:00",
        "day": "monday",
        "breakDurationMinutes": 60,
        "notes": "Regular Shift",
        "workHourStart": "22:00",
        "requiredHours": 8,
        "isRestDay": false
      },
      "saturday": {
        "day": "saturday",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "notes": "Regular Shift",
        "requiredHours": 8
      }
    },
    "dailyRate": 600,
    "employmentType": "Full-time",
    "scheduleOverride": {
      "breakDurationMinutes": 60,
      "updatedAt": 1793627502934,
      "date": "2026-11-02",
      "workHourStart": "22:00",
      "isRestDay": false,
      "workHourEnd": "07:00",
      "reason": "",
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "requiredHours": 8,
      "updatedBy": "Admin"
    },
    "pin": "1234",
    "firstName": "ISRAEL",
    "dateHired": "2026-02-03",
    "workHourStart": "22:00",
    "phone": "",
    "workHourEnd": "07:00",
    "otRate": 75,
    "breakStart": "03:00",
    "isAdmin": false,
    "salaryHistory": [],
    "employeeNumber": "011",
    "status": "Active",
    "salary": 12000,
    "allowance": 3000,
    "requiredHours": 8,
    "profilePicture": "data:image/jpeg;base64,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",
    "department": "Graphic Design",
    "scheduleType": "weekly",
    "id": "GqrfyNJ5UkLWNn7ZOwq7",
    "schedule": {
      "saturday": {
        "breakStart": "03:00",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 0,
        "breakEnd": "04:00",
        "enabled": false
      },
      "friday": {
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "enabled": true,
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "workHourStart": "22:00"
      },
      "monday": {
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "requiredHours": 8,
        "breakEnd": "04:00",
        "enabled": true,
        "workHourStart": "22:00"
      },
      "sunday": {
        "enabled": false,
        "breakEnd": "04:00",
        "requiredHours": 0,
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "workHourEnd": "07:00"
      },
      "tuesday": {
        "requiredHours": 8,
        "breakStart": "03:00",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "enabled": true,
        "breakEnd": "04:00"
      },
      "wednesday": {
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "enabled": true,
        "breakEnd": "04:00",
        "breakStart": "03:00"
      },
      "thursday": {
        "workHourStart": "22:00",
        "requiredHours": 8,
        "enabled": true,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "workHourEnd": "07:00"
      }
    },
    "middleName": "P",
    "birthday": "1995-01-01",
    "breakEnd": "04:00"
  },
  {
    "position": "Graphic Designer",
    "workHourEnd": "06:00",
    "middleName": "L",
    "lastName": "MALLARI",
    "salary": 12000,
    "status": "Active",
    "scheduleOverride": {
      "requiredHours": 8,
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "reason": "",
      "workHourEnd": "07:00",
      "updatedBy": "Admin",
      "updatedAt": 1793627510526,
      "breakDurationMinutes": 60,
      "workHourStart": "22:00",
      "isRestDay": false,
      "date": "2026-11-02"
    },
    "department": "Graphic Design",
    "employmentType": "Full-time",
    "shiftEnd": "07:00",
    "workHourStart": "21:00",
    "allowance": 3000,
    "weeklySchedule": {
      "thursday": {
        "workHourEnd": "06:00",
        "day": "thursday",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "notes": "Regular Shift",
        "workHourStart": "21:00"
      },
      "monday": {
        "workHourStart": "21:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "day": "monday",
        "workHourEnd": "06:00",
        "notes": "Regular Shift",
        "isRestDay": false
      },
      "sunday": {
        "workHourStart": "21:00",
        "breakDurationMinutes": 60,
        "isRestDay": true,
        "requiredHours": 8,
        "workHourEnd": "06:00",
        "notes": "Rest Day",
        "day": "sunday"
      },
      "friday": {
        "workHourEnd": "06:00",
        "breakDurationMinutes": 60,
        "workHourStart": "21:00",
        "day": "friday",
        "notes": "Regular Shift",
        "requiredHours": 8,
        "isRestDay": false
      },
      "tuesday": {
        "isRestDay": false,
        "workHourEnd": "06:00",
        "notes": "Regular Shift",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "day": "tuesday",
        "workHourStart": "21:00"
      },
      "saturday": {
        "isRestDay": false,
        "day": "saturday",
        "workHourEnd": "06:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "notes": "Regular Shift",
        "workHourStart": "21:00"
      },
      "wednesday": {
        "breakDurationMinutes": 60,
        "notes": "Regular Shift",
        "workHourEnd": "06:00",
        "requiredHours": 8,
        "isRestDay": false,
        "day": "wednesday",
        "workHourStart": "21:00"
      }
    },
    "scheduleNotes": "Weekly Work Schedule",
    "fullName": "MALLARI, HERMINIO JR L",
    "pin": "2626",
    "scheduleType": "weekly",
    "breakStart": "03:00",
    "id": "H5sUNWrTGJAjUj2IgFPY",
    "email": "jrmallari.oligarchmedia@gmail.com",
    "profilePicture": "data:image/jpeg;base64,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",
    "isAdmin": false,
    "updatedAt": 1792686000527,
    "shiftStart": "22:00",
    "employeeNumber": "008",
    "otRate": 75,
    "dailyRate": 600,
    "breakEnd": "04:00",
    "salaryHistory": [],
    "birthday": "1996-04-26",
    "phone": "",
    "schedule": {
      "wednesday": {
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "enabled": true
      },
      "tuesday": {
        "breakStart": "03:00",
        "requiredHours": 8,
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "enabled": true,
        "workHourEnd": "07:00"
      },
      "thursday": {
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "requiredHours": 8,
        "breakStart": "03:00",
        "workHourEnd": "07:00",
        "enabled": true
      },
      "sunday": {
        "workHourEnd": "07:00",
        "enabled": false,
        "requiredHours": 0,
        "breakEnd": "04:00",
        "workHourStart": "22:00",
        "breakStart": "03:00"
      },
      "friday": {
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "enabled": true,
        "workHourStart": "22:00",
        "requiredHours": 8,
        "workHourEnd": "07:00"
      },
      "monday": {
        "requiredHours": 8,
        "enabled": true,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "breakStart": "03:00"
      },
      "saturday": {
        "breakStart": "03:00",
        "requiredHours": 0,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "enabled": false
      }
    },
    "firstName": "HERMINIO JR",
    "dateHired": "2024-07-10",
    "requiredHours": 8
  },
  {
    "workHourStart": "22:00",
    "phone": "",
    "allowance": 3000,
    "employeeNumber": "003",
    "scheduleNotes": "Weekly Work Schedule",
    "pin": "0911",
    "otRate": 112.5,
    "salaryHistory": [],
    "position": "Graphic Designer",
    "shiftEnd": "07:00",
    "schedule": {
      "thursday": {
        "workHourStart": "22:00",
        "enabled": true,
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "breakEnd": "04:00"
      },
      "tuesday": {
        "requiredHours": 8,
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "workHourEnd": "07:00",
        "enabled": true
      },
      "sunday": {
        "breakEnd": "04:00",
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "requiredHours": 0,
        "enabled": false
      },
      "friday": {
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "enabled": true
      },
      "monday": {
        "breakStart": "03:00",
        "enabled": true,
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "breakEnd": "04:00"
      },
      "wednesday": {
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "requiredHours": 8,
        "enabled": true,
        "breakEnd": "04:00"
      },
      "saturday": {
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "requiredHours": 0,
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "enabled": false
      }
    },
    "firstName": "JERMAINE FRANKIE",
    "employmentType": "Full-time",
    "status": "Active",
    "department": "Graphic Design",
    "breakStart": "03:00",
    "fullName": "SOMBILLO, JERMAINE FRANKIE C",
    "profilePicture": "data:image/jpeg;base64,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",
    "dateHired": "2024-08-19",
    "scheduleOverride": {
      "updatedBy": "Admin",
      "workHourEnd": "07:00",
      "date": "2026-11-02",
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "reason": "",
      "requiredHours": 8,
      "breakDurationMinutes": 60,
      "isRestDay": false,
      "workHourStart": "22:00",
      "updatedAt": 1793627521294
    },
    "middleName": "C",
    "requiredHours": 8,
    "updatedAt": 1793719315583,
    "weeklySchedule": {
      "wednesday": {
        "notes": "Regular Night Shift (10PM–7AM)",
        "day": "wednesday",
        "breakDurationMinutes": 60,
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "workHourStart": "22:00",
        "isRestDay": false
      },
      "thursday": {
        "notes": "Regular Night Shift (10PM–7AM)",
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "requiredHours": 8,
        "isRestDay": false,
        "day": "thursday"
      },
      "saturday": {
        "breakDurationMinutes": 60,
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "workHourStart": "22:00",
        "notes": "Regular Night Shift (10PM–7AM)",
        "isRestDay": false,
        "day": "saturday"
      },
      "tuesday": {
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "notes": "Regular Night Shift (10PM–7AM)",
        "day": "tuesday",
        "workHourStart": "22:00",
        "requiredHours": 8,
        "workHourEnd": "07:00"
      },
      "sunday": {
        "breakDurationMinutes": 60,
        "isRestDay": true,
        "requiredHours": 8,
        "notes": "Rest Day",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "day": "sunday"
      },
      "friday": {
        "requiredHours": 8,
        "isRestDay": false,
        "day": "friday",
        "workHourStart": "22:00",
        "notes": "Regular Night Shift (10PM–7AM)",
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60
      },
      "monday": {
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "notes": "Regular Night Shift (10PM–7AM)",
        "day": "monday",
        "isRestDay": false
      }
    },
    "email": "jf.oligarchmediaph@gmail.com",
    "isAdmin": false,
    "dailyRate": 900,
    "breakEnd": "04:00",
    "lastName": "SOMBILLO",
    "salary": 18000,
    "id": "LcI0iH4hyGeq4iZjjmAL",
    "workHourEnd": "07:00",
    "shiftStart": "22:00",
    "scheduleType": "weekly",
    "birthday": "2001-10-20"
  },
  {
    "salary": 14000,
    "status": "Active",
    "position": "Graphic Designer",
    "scheduleOverride": {
      "date": "2026-11-02",
      "isRestDay": false,
      "workHourEnd": "07:00",
      "updatedAt": 1793627542222,
      "requiredHours": 8,
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "reason": "",
      "breakDurationMinutes": 60,
      "updatedBy": "Admin",
      "workHourStart": "22:00"
    },
    "lastName": "CRUZ",
    "salaryHistory": [],
    "requiredHours": 8,
    "id": "bRCMrIkyZwkDyEbY6C6S",
    "dateHired": "2025-01-21",
    "firstName": "AARON",
    "profilePicture": "data:image/jpeg;base64,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",
    "shiftEnd": "07:00",
    "dailyRate": 700,
    "employeeNumber": "007",
    "fullName": "CRUZ, AARON P",
    "updatedAt": 1793627091407,
    "shiftStart": "22:00",
    "email": "aaroncruzoligarchmediaph@gmail.com",
    "department": "Graphic Design",
    "pin": "1234",
    "scheduleNotes": "Weekly Work Schedule",
    "middleName": "P",
    "weeklySchedule": {
      "thursday": {
        "requiredHours": 8,
        "notes": "Regular Shift",
        "isRestDay": false,
        "day": "thursday",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60
      },
      "sunday": {
        "isRestDay": true,
        "workHourEnd": "07:00",
        "day": "sunday",
        "workHourStart": "22:00",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "notes": "Rest Day"
      },
      "friday": {
        "notes": "Regular Shift",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "day": "friday",
        "requiredHours": 8
      },
      "monday": {
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "requiredHours": 8,
        "workHourStart": "22:00",
        "notes": "Regular Shift",
        "workHourEnd": "07:00",
        "day": "monday"
      },
      "tuesday": {
        "isRestDay": false,
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "notes": "Regular Shift",
        "day": "tuesday",
        "workHourEnd": "07:00"
      },
      "wednesday": {
        "notes": "Regular Shift",
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "workHourStart": "22:00",
        "day": "wednesday",
        "workHourEnd": "07:00",
        "requiredHours": 8
      },
      "saturday": {
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "isRestDay": false,
        "day": "saturday",
        "workHourEnd": "07:00",
        "notes": "Regular Shift",
        "workHourStart": "22:00"
      }
    },
    "workHourEnd": "07:00",
    "isAdmin": false,
    "scheduleType": "custom",
    "employmentType": "Full-time",
    "otRate": 87.5,
    "breakStart": "03:00",
    "phone": "",
    "allowance": 3000,
    "workHourStart": "22:00",
    "breakEnd": "04:00",
    "birthday": "1995-01-01",
    "schedule": {
      "tuesday": {
        "workHourStart": "22:00",
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "enabled": true,
        "breakEnd": "04:00"
      },
      "saturday": {
        "enabled": false,
        "breakEnd": "04:00",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "requiredHours": 0
      },
      "friday": {
        "workHourEnd": "07:00",
        "enabled": true,
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "workHourStart": "22:00",
        "requiredHours": 8
      },
      "thursday": {
        "requiredHours": 8,
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "workHourEnd": "07:00",
        "breakEnd": "04:00",
        "enabled": true
      },
      "sunday": {
        "workHourStart": "22:00",
        "enabled": false,
        "requiredHours": 0,
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "breakEnd": "04:00"
      },
      "monday": {
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "requiredHours": 8,
        "enabled": true
      },
      "wednesday": {
        "enabled": true,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "requiredHours": 8
      }
    }
  },
  {
    "id": "fihflPzrDZWkYd60bfMG",
    "department": "Graphic Design",
    "workHourEnd": "07:00",
    "breakEnd": "04:00",
    "employeeNumber": "012",
    "scheduleOverride": {
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "workHourEnd": "07:00",
      "reason": "",
      "updatedBy": "Admin",
      "requiredHours": 8,
      "date": "2026-11-02",
      "updatedAt": 1793627550702,
      "breakDurationMinutes": 60,
      "isRestDay": false,
      "workHourStart": "22:00"
    },
    "birthday": "2002-10-21",
    "middleName": "G",
    "schedule": {
      "saturday": {
        "workHourStart": "22:00",
        "enabled": false,
        "breakEnd": "04:00",
        "requiredHours": 0,
        "workHourEnd": "07:00",
        "breakStart": "03:00"
      },
      "sunday": {
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "enabled": false,
        "requiredHours": 0,
        "workHourStart": "22:00",
        "workHourEnd": "07:00"
      },
      "monday": {
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "enabled": true,
        "workHourStart": "22:00",
        "breakEnd": "04:00"
      },
      "wednesday": {
        "requiredHours": 8,
        "enabled": true,
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "workHourStart": "22:00",
        "breakEnd": "04:00"
      },
      "friday": {
        "workHourStart": "22:00",
        "requiredHours": 8,
        "breakStart": "03:00",
        "workHourEnd": "07:00",
        "breakEnd": "04:00",
        "enabled": true
      },
      "tuesday": {
        "requiredHours": 8,
        "workHourStart": "22:00",
        "enabled": true,
        "workHourEnd": "07:00",
        "breakEnd": "04:00",
        "breakStart": "03:00"
      },
      "thursday": {
        "workHourEnd": "07:00",
        "enabled": true,
        "requiredHours": 8,
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "workHourStart": "22:00"
      }
    },
    "email": "roland.oligarchmediaph@gmail.com",
    "profilePicture": "data:image/jpeg;base64,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",
    "breakStart": "03:00",
    "status": "Active",
    "allowance": 3000,
    "salary": 12000,
    "scheduleType": "custom",
    "phone": "",
    "salaryHistory": [],
    "requiredHours": 8,
    "otRate": 75,
    "fullName": "CUBOL, ROLAND JHON G",
    "dateHired": "2026-02-03",
    "firstName": "ROLAND JHON",
    "dailyRate": 600,
    "workHourStart": "22:00",
    "position": "Graphic Designer",
    "scheduleNotes": "Weekly Work Schedule",
    "weeklySchedule": {
      "tuesday": {
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60,
        "day": "tuesday",
        "notes": "Regular Shift",
        "isRestDay": false,
        "workHourStart": "22:00",
        "requiredHours": 8
      },
      "sunday": {
        "notes": "Rest Day",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "day": "sunday",
        "breakDurationMinutes": 60,
        "isRestDay": true,
        "workHourStart": "22:00"
      },
      "friday": {
        "notes": "Regular Shift",
        "breakDurationMinutes": 60,
        "day": "friday",
        "workHourStart": "22:00",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "requiredHours": 8
      },
      "monday": {
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "isRestDay": false,
        "notes": "Regular Shift",
        "workHourStart": "22:00",
        "day": "monday",
        "breakDurationMinutes": 60
      },
      "saturday": {
        "requiredHours": 8,
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "day": "saturday",
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "notes": "Regular Shift"
      },
      "thursday": {
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "isRestDay": false,
        "notes": "Regular Shift",
        "breakDurationMinutes": 60,
        "day": "thursday",
        "workHourStart": "22:00"
      },
      "wednesday": {
        "day": "wednesday",
        "requiredHours": 8,
        "workHourStart": "22:00",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "notes": "Regular Shift",
        "breakDurationMinutes": 60
      }
    },
    "lastName": "CUBOL",
    "updatedAt": 1793627103583,
    "employmentType": "Full-time",
    "shiftEnd": "07:00",
    "shiftStart": "22:00",
    "pin": "2002",
    "isAdmin": false
  },
  {
    "shiftStart": "22:00",
    "position": "Graphic Designer",
    "profilePicture": "data:image/jpeg;base64,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",
    "lastName": "TARUC",
    "pin": "1002",
    "updatedAt": 1793627121343,
    "scheduleOverride": {
      "requiredHours": 8,
      "date": "2026-11-02",
      "updatedBy": "Admin",
      "reason": "11:00 PM – 8:00 AM Shift",
      "notes": "11:00 PM – 8:00 AM Shift",
      "isRestDay": false,
      "workHourEnd": "07:00",
      "breakDurationMinutes": 60,
      "workHourStart": "22:00",
      "updatedAt": 1793627207645
    },
    "scheduleType": "custom",
    "phone": "",
    "shiftEnd": "07:00",
    "fullName": "TARUC, RAYVEL M",
    "dailyRate": 600,
    "otRate": 75,
    "requiredHours": 8,
    "email": "rayvel.oligarchmedia.ph@gmail.com",
    "firstName": "RAYVEL",
    "dateHired": "2025-09-22",
    "id": "mwPt8K4toobHVG29RFcJ",
    "employeeNumber": "009",
    "salaryHistory": [],
    "employmentType": "Full-time",
    "weeklySchedule": {
      "saturday": {
        "day": "saturday",
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "notes": "Regular Shift"
      },
      "wednesday": {
        "breakDurationMinutes": 60,
        "day": "wednesday",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "notes": "Regular Shift",
        "requiredHours": 8
      },
      "tuesday": {
        "notes": "Regular Shift",
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "day": "tuesday"
      },
      "monday": {
        "day": "monday",
        "workHourEnd": "07:00",
        "isRestDay": false,
        "workHourStart": "22:00",
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "notes": "Regular Shift"
      },
      "friday": {
        "breakDurationMinutes": 60,
        "workHourStart": "22:00",
        "day": "friday",
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "notes": "Regular Shift",
        "isRestDay": false
      },
      "sunday": {
        "isRestDay": true,
        "workHourStart": "22:00",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "notes": "Rest Day",
        "workHourEnd": "07:00",
        "day": "sunday"
      },
      "thursday": {
        "requiredHours": 8,
        "workHourStart": "22:00",
        "notes": "Regular Shift",
        "day": "thursday",
        "isRestDay": false,
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60
      }
    },
    "status": "Active",
    "salary": 12000,
    "isAdmin": false,
    "workHourStart": "22:00",
    "allowance": 3000,
    "workHourEnd": "07:00",
    "breakStart": "03:00",
    "middleName": "M",
    "scheduleNotes": "Weekly Work Schedule",
    "schedule": {
      "wednesday": {
        "breakEnd": "04:00",
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "enabled": true,
        "workHourEnd": "07:00",
        "requiredHours": 8
      },
      "thursday": {
        "enabled": true,
        "workHourEnd": "07:00",
        "breakEnd": "04:00",
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "requiredHours": 8
      },
      "tuesday": {
        "workHourStart": "22:00",
        "enabled": true,
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "breakEnd": "04:00",
        "breakStart": "03:00"
      },
      "monday": {
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "enabled": true,
        "breakEnd": "04:00"
      },
      "friday": {
        "workHourEnd": "07:00",
        "enabled": true,
        "breakStart": "03:00",
        "requiredHours": 8,
        "workHourStart": "22:00",
        "breakEnd": "04:00"
      },
      "sunday": {
        "enabled": false,
        "workHourEnd": "07:00",
        "breakEnd": "04:00",
        "workHourStart": "22:00",
        "breakStart": "03:00",
        "requiredHours": 0
      },
      "saturday": {
        "workHourStart": "22:00",
        "requiredHours": 0,
        "breakEnd": "04:00",
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "enabled": false
      }
    },
    "department": "Graphic Design",
    "breakEnd": "04:00",
    "birthday": "2002-10-01"
  },
  {
    "birthday": "2001-09-07",
    "otRate": 137.5,
    "phone": "",
    "firstName": "MARK LIONARD",
    "breakEnd": "04:00",
    "lastName": "GATUS",
    "updatedAt": 1793627158375,
    "scheduleType": "custom",
    "dateHired": "2024-08-26",
    "weeklySchedule": {
      "thursday": {
        "requiredHours": 8,
        "workHourEnd": "07:00",
        "breakDurationMinutes": 60,
        "notes": "Regular Shift",
        "workHourStart": "22:00",
        "day": "thursday",
        "isRestDay": false
      },
      "tuesday": {
        "workHourStart": "22:00",
        "isRestDay": false,
        "requiredHours": 8,
        "notes": "Regular Shift",
        "breakDurationMinutes": 60,
        "day": "tuesday",
        "workHourEnd": "07:00"
      },
      "monday": {
        "workHourStart": "22:00",
        "day": "monday",
        "isRestDay": false,
        "breakDurationMinutes": 60,
        "notes": "Regular Shift",
        "requiredHours": 8,
        "workHourEnd": "07:00"
      },
      "friday": {
        "requiredHours": 8,
        "workHourStart": "22:00",
        "day": "friday",
        "workHourEnd": "07:00",
        "isRestDay": false,
        "notes": "Regular Shift",
        "breakDurationMinutes": 60
      },
      "sunday": {
        "requiredHours": 8,
        "breakDurationMinutes": 60,
        "notes": "Rest Day",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "isRestDay": true,
        "day": "sunday"
      },
      "wednesday": {
        "day": "wednesday",
        "breakDurationMinutes": 60,
        "isRestDay": false,
        "workHourEnd": "07:00",
        "notes": "Regular Shift",
        "workHourStart": "22:00",
        "requiredHours": 8
      },
      "saturday": {
        "workHourStart": "22:00",
        "day": "saturday",
        "breakDurationMinutes": 60,
        "requiredHours": 8,
        "notes": "Regular Shift",
        "workHourEnd": "07:00",
        "isRestDay": false
      }
    },
    "dailyRate": 1100,
    "fullName": "GATUS, MARK LIONARD S",
    "requiredHours": 8,
    "profilePicture": "data:image/jpeg;base64,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",
    "schedule": {
      "tuesday": {
        "workHourStart": "22:00",
        "requiredHours": 8,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "enabled": true,
        "workHourEnd": "07:00"
      },
      "thursday": {
        "breakStart": "03:00",
        "breakEnd": "04:00",
        "workHourEnd": "07:00",
        "requiredHours": 8,
        "workHourStart": "22:00",
        "enabled": true
      },
      "friday": {
        "workHourStart": "22:00",
        "enabled": true,
        "breakEnd": "04:00",
        "breakStart": "03:00",
        "requiredHours": 8,
        "workHourEnd": "07:00"
      },
      "sunday": {
        "breakStart": "03:00",
        "requiredHours": 0,
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "workHourEnd": "07:00",
        "enabled": false
      },
      "monday": {
        "workHourStart": "22:00",
        "breakEnd": "04:00",
        "enabled": true,
        "requiredHours": 8,
        "breakStart": "03:00",
        "workHourEnd": "07:00"
      },
      "wednesday": {
        "breakEnd": "04:00",
        "enabled": true,
        "workHourEnd": "07:00",
        "breakStart": "03:00",
        "requiredHours": 8,
        "workHourStart": "22:00"
      },
      "saturday": {
        "requiredHours": 0,
        "enabled": false,
        "breakStart": "03:00",
        "workHourStart": "22:00",
        "workHourEnd": "07:00",
        "breakEnd": "04:00"
      }
    },
    "shiftEnd": "07:00",
    "employmentType": "Full-time",
    "workHourEnd": "07:00",
    "position": "Graphic Designer",
    "shiftStart": "22:00",
    "salaryHistory": [],
    "salary": 22000,
    "allowance": 3000,
    "employeeNumber": "004",
    "middleName": "S",
    "workHourStart": "22:00",
    "pin": "2001",
    "scheduleNotes": "Weekly Work Schedule",
    "id": "nFdlVMmUTmapjGR3J3Ed",
    "breakStart": "03:00",
    "status": "Active",
    "department": "Graphic Design",
    "isAdmin": false,
    "scheduleOverride": {
      "workHourStart": "22:00",
      "date": "2026-11-02",
      "breakDurationMinutes": 60,
      "workHourEnd": "07:00",
      "notes": "Shift Override: 10:00 PM – 7:00 AM",
      "updatedBy": "Admin",
      "reason": "",
      "updatedAt": 1793627561102,
      "requiredHours": 8,
      "isRestDay": false
    },
    "email": "markgatus.oligarchmedia@gmail.com"
  },
  {
    "dateHired": "2024-07-04",
    "email": "jaopangan.oligarchmedia@gmail.com",
    "dailyRate": 1100,
    "status": "Active",
    "profilePicture": "data:image/jpeg;base64,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",
    "id": "Y5fCWLfZk5lfg2Ocp1f9",
    "position": "Graphic Designer",
    "lastName": "PANGAN",
    "otRate": 137.5,
    "allowance": 3000,
    "middleName": "G",
    "salary": 22000,
    "updatedAt": 1793825889036,
    "phone": "+63 917 555 1234",
    "birthday": "2001-07-18",
    "department": "Graphic Design",
    "pin": "1818",
    "isAdmin": false,
    "employmentType": "Full-time",
    "employeeNumber": "002",
    "workHourStart": "22:00",
    "workHourEnd": "07:00",
    "firstName": "JOEMARIE",
    "fullName": "PANGAN, JOEMARIE G"
  }
]) as any;

export const OFFICIAL_JOEMARIE_PANGAN = OFFICIAL_STAFF_ROSTER.find(e => e.employeeNumber === "002") || OFFICIAL_STAFF_ROSTER[0];
