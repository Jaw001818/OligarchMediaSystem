import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, doublePrecision } from 'drizzle-orm/pg-core';

// Users table (mandatory for Firebase Auth link)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Employees relational table
export const employees = pgTable('employees', {
  id: serial('id').primaryKey(),
  employeeNumber: text('employee_number').notNull().unique(),
  fullName: text('full_name').notNull(),
  email: text('email'),
  department: text('department'),
  position: text('position'),
  salary: doublePrecision('salary').default(0),
  dailyRate: doublePrecision('daily_rate').default(0),
  status: text('status').default('Active'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Attendance records relational table
export const attendance = pgTable('attendance', {
  id: serial('id').primaryKey(),
  employeeNumber: text('employee_number').notNull(),
  employeeName: text('employee_name').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  timeIn: text('time_in'),
  timeOut: text('time_out'),
  hoursWorked: doublePrecision('hours_worked').default(0),
  lateMinutes: integer('late_minutes').default(0),
  otHours: doublePrecision('ot_hours').default(0),
  status: text('status').notNull().default('Present'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Leave Requests relational table
export const leaveRequests = pgTable('leave_requests', {
  id: serial('id').primaryKey(),
  employeeNumber: text('employee_number').notNull(),
  employeeName: text('employee_name').notNull(),
  type: text('type').notNull(), // Vacation, Sick, Emergency, Birthday
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('Pending'),
  createdAt: timestamp('created_at').defaultNow(),
});
