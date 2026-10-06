/* =====================================================================
   CORE DATA — shared by every level file (js/data-l1.js … data-l4.js).
   Each level file only adds schedule rows:  RAW_PARTS.push(`...rows...`);
   Row format (fields separated by "|"):
     course | type | day | startHour | hours | sections | roomKey | instructor
   type: L lecture · B lab · T tutorial     day: Sat Sun Mon Tue Wed Thu
   startHour: 24-hour number (8 = 8:00, 14 = 2:00 PM)     sections: * or 43,44
   Group header lines look like:  #4-CS   #1-G4   #3-IS   (level-group)
   ===================================================================== */

/* Which levels offer the "Common courses (no specialization)" option */
const COMMON_LEVELS = ['3', '4'];

/* Groups (Levels 1-2) and specializations (Levels 3-4) */
const GROUPS = {
  1: ['G1','G2','G3','G4'],
  2: ['G1','G2'],
  3: ['CS','IS','SC','CSys'],
  4: ['CS','IS','SC','CSys']
};

/* Courses: id: ['Full course name', 'ABBR'] — shown as "Full course name (ABBR)" */
const COURSES = {
  /* Level 1 */
  PHY: ['Physics 1','PHY1'],
  ICS: ['Introduction to Computers','ICS'],
  CAL: ['Calculus 1','CALC1'],
  PRB: ['Probability and Statistics','PROB'],
  /* Level 2 */
  OOP: ['Object Oriented Programming','OOP'],
  DBMS:['Database Management Systems','DBMS'],
  LD:  ['Logic Design','LD'],
  SA:  ['Statistical Analysis','SA'],
  DISC:['Discrete Mathematics','DISC'],
  /* Level 3 */
  OS:  ['Operating Systems','OS'],
  CN:  ['Computer Networks','CN'],
  SAD: ['System Analysis and Design','SAD'],
  DSP: ['Digital Signal Processing','DSP'],
  NUM: ['Numerical Computing','NC'],
  DM:  ['Data Mining','DM'],
  SI:  ['Statistical Inference','SI'],
  MPI: ['Microprocessors and Interfacing','MPI'],
  CT:  ['Compiler Theory','CT'],
  /* Level 4 */
  NND: ['Neural Networks and Deep Learning','NNDL'],
  IOT: ['Internet of Things','IoT'],
  MC:  ['Mobile Computing','MC'],
  IMP: ['Image Processing','IP'],
  LGP: ['Logic Programming','LP'],
  CYB: ['Cyber Security','CYBER'],
  HCI: ['Human Computer Interaction','HCI'],
  DS:  ['Data Science','DS'],
  SDP: ['Software Design Patterns','SDP'],
  QC:  ['Quantum Computing','QC'],
  CGM: ['Computational Geometry','CG'],
  GDD: ['Game Design and Development','GDD'],
  CV:  ['Computer Vision','CV'],
  PDA: ['Parallel and Distributed Architectures','PDA'],
  RTS: ['Real-Time Systems','RTS'],
  ML:  ['Machine Learning','ML']
};

/* Optional per-group notes: 'level-group': 'message shown under the course list' */
const NOTES = {};

/* Rooms: key: ['Arabic name (kept in Arabic)', 'English name'] — empty Arabic = English only */
const LOCS = {
  CL1:['معمل حاسبات 1','CIS Lab 1'], CL2:['معمل حاسبات 2','CIS Lab 2'], CL3:['معمل حاسبات 3','CIS Lab 3'],
  CL5:['معمل حاسبات 5','CIS Lab 5'], CL6:['معمل حاسبات 6','CIS Lab 6'], CL7:['معمل حاسبات 7','CIS Lab 7'],
  HP:['معمل HP','HP Lab'],            PH:['معمل الفيزياء','Physics Lab'],  CS:['معمل نظم الحاسبات','CSys Lab'],
  SC:['معمل الحسابات العلمية','SC Lab'], IS:['معمل نظم المعلومات','IS Lab'], RB:['معمل الروبوت','Robot Lab'],
  SE1:['معمل هندسة البرمجيات 1','Software Engineering Lab 1'], SE2:['معمل هندسة برمجيات 2','Software Engineering Lab 2'],
  LB:['معمل ب','Lab B'], GH:['مدرج جنيدى','Genedy Hall'],
  H1:['','Hall 1'], C1:['','Class 1'], C4:['','Class 4'], C5:['','Class 5'], C6:['','Class 6'], C7:['','Class 7'], C8:['','Class 8'],
  E1:['مبنى الامتحانات - الدور الثالث - قاعة 1','Exam Building - Third Floor - Hall 1'],
  E2:['مبنى الامتحانات - الدور الثالث - قاعة 2','Exam Building - Third Floor - Hall 2'],
  E3:['مبنى الامتحانات - الدور الثالث - قاعة 3','Exam Building - Third Floor - Hall 3']
};

const RAW_PARTS = [];   // filled by the level files