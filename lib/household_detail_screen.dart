import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'models/household.dart';
import 'models/priestor.dart';
import 'models/cinnost.dart';
import 'constants.dart';
import 'utils/cinnost_utils.dart';

class HouseholdDetailScreen extends StatefulWidget {
  final Household household;

  const HouseholdDetailScreen({super.key, required this.household});

  @override
  State<HouseholdDetailScreen> createState() => _HouseholdDetailScreenState();
}

class _HouseholdDetailScreenState extends State<HouseholdDetailScreen> {
  int _selectedIndex = 0;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  List<Priestor> _priestory = [];
  List<Cinnost> _cinnosti = [];
  String? _selectedUser;
  
  // Kalendár
  DateTime _selectedDate = DateTime.now();
  int _calendarMonth = 0;
  int _calendarYear = 0;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _calendarMonth = now.month;
    _calendarYear = now.year;
    _selectedDate = now;
    _loadPriestory();
    _loadCinnosti();
  }

  @override
  void dispose() {
    super.dispose();
  }

  void _previousMonth() {
    setState(() {
      _calendarMonth--;
      if (_calendarMonth < 1) {
        _calendarMonth = 12;
        _calendarYear--;
      }
    });
  }

  void _nextMonth() {
    setState(() {
      _calendarMonth++;
      if (_calendarMonth > 12) {
        _calendarMonth = 1;
        _calendarYear++;
      }
    });
  }

  void _goToToday() {
    final now = DateTime.now();
    setState(() {
      _calendarMonth = now.month;
      _calendarYear = now.year;
      _selectedDate = now;
    });
  }

  Future<void> _loadPriestory() async {
    try {
      QuerySnapshot snapshot = await _firestore
          .collection('priestory')
          .where('householdId', isEqualTo: widget.household.id)
          .get();

      setState(() {
        _priestory = snapshot.docs
            .map(
              (doc) =>
                  Priestor.fromMap(doc.data() as Map<String, dynamic>, doc.id),
            )
            .toList();
      });
    } catch (e) {
      print('Chyba pri načítaní priestorov: $e');
    }
  }

  Future<void> _loadCinnosti() async {
    try {
      QuerySnapshot snapshot = await _firestore
          .collection('cinnosti')
          .where('householdId', isEqualTo: widget.household.id)
          .get();

      setState(() {
        _cinnosti = snapshot.docs
            .map(
              (doc) =>
                  Cinnost.fromMap(doc.data() as Map<String, dynamic>, doc.id),
            )
            .toList();
      });
    } catch (e) {
      print('Chyba pri načítaní činností: $e');
    }
  }

  void _addPriestor(String name) async {
    try {
      final newPriestor = Priestor(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        householdId: widget.household.id,
        name: name,
        createdAt: DateTime.now(),
      );

      setState(() {
        _priestory.add(newPriestor);
      });

      final docRef = await _firestore
          .collection('priestory')
          .add(newPriestor.toMap());

      setState(() {
        final index = _priestory.indexWhere((p) => p.id == newPriestor.id);
        if (index != -1) {
          _priestory[index] = newPriestor.copyWith(id: docRef.id);
        }
      });

      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Priestor "$name" bol pridaný')));
    } catch (e) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Chyba: $e')));
    }
  }

  List<Cinnost> get _filteredCinnosti {
    if (_selectedUser == null) return _cinnosti;
    return _cinnosti.where((c) => c.assignedTo == _selectedUser).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      extendBody: false,
      appBar: AppBar(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        title: Text(widget.household.name),
        centerTitle: true,
      ),
      body: Stack(
        children: [
          // Background image
          Container(
            decoration: const BoxDecoration(
              image: DecorationImage(
                image: AssetImage('assets/textures/screens_bcg.png'),
                fit: BoxFit.cover,
              ),
            ),
          ),
          // Content
          Column(children: [_buildBody()]),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedIndex,
        onTap: (index) {
          setState(() {
            _selectedIndex = index;
          });
        },
        backgroundColor: Colors.transparent,
        selectedItemColor: AppColors.primary,
        unselectedItemColor: AppColors.textSecondary,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.list), label: 'Moj Rozpis'),
          BottomNavigationBarItem(
            icon: Icon(Icons.calendar_month),
            label: 'Planovanie',
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_selectedIndex == 0) {
      return _buildRozpisTab();
    } else {
      return _buildPlanovaneTab();
    }
  }

  Widget _buildRozpisTab() {
    final currentUser = _auth.currentUser?.email ?? '';

    // Filtrovať činnosti priradené aktuálnemu užívateľovi
    final myTasks = _cinnosti
        .where((c) => c.assignedTo == currentUser)
        .toList();

    // Filtrovať iba činnosti na vybraný deň
    final tasksForSelectedDay = _getTasksForDate(_selectedDate)
        .where((c) => c.assignedTo == currentUser)
        .toList();

    if (myTasks.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.checklist, size: 64, color: AppColors.textSecondary),
            const SizedBox(height: 16),
            Text(
              'Moj Rozpis',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Nemáš žiadne priradené činnosti',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ],
        ),
      );
    }

    return Expanded(
      child: Column(
        children: [
          _buildCalendarHeader(),
          Expanded(
            child: tasksForSelectedDay.isEmpty
                ? Center(
                    child: Text(
                      'Žiadne činnosti na ${_formatDate(_selectedDate)}',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  )
                : SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 80),
                    child: Column(
                      children: [
                        ...tasksForSelectedDay.map((task) {
                          return _buildTaskItem(task, showButton: true);
                        }),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildTaskItem(Cinnost task, {bool showButton = false}) {
    final priestor = _priestory.firstWhere(
      (p) => p.id == task.priestorId,
      orElse: () => Priestor(
        id: '',
        householdId: widget.household.id,
        name: 'Neznámy priestor',
        createdAt: DateTime.now(),
      ),
    );

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      color: AppColors.background.withOpacity(0.7),
      elevation: 1,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        leading: Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: CinnostColors.hexToColor(task.color),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(
            CinnostIcons.getIcon(task.icon),
            color: Colors.white,
            size: 18,
          ),
        ),
        title: Text(
          task.name,
          style: TextStyle(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Row(
              children: [
                Icon(
                  Icons.location_on,
                  size: 12,
                  color: AppColors.textSecondary,
                ),
                const SizedBox(width: 3),
                Text(
                  priestor.name,
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
            Row(
              children: [
                Icon(
                  Icons.calendar_today,
                  size: 14,
                  color: AppColors.textSecondary,
                ),
                const SizedBox(width: 4),
                Text(
                  _formatDate(task.dueDate),
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ],
        ),
        trailing: showButton
            ? SizedBox(
                width: 120,
                child: OutlinedButton.icon(
                  onPressed: () async {
                    try {
                      DateTime? nextDueDate;

                      // Ak nema opakovanie, vymas ju
                      if (task.periodicity == Periodicity.none) {
                        await _firestore
                            .collection('cinnosti')
                            .doc(task.id)
                            .delete();

                        setState(() {
                          _cinnosti.removeWhere((c) => c.id == task.id);
                        });
                      } else {
                        // Ma opakovanie - vypocitaj dalsi datum
                        nextDueDate = task.dueDate;
                        final repeatDays = task.repeatInterval ?? 1;

                        switch (task.periodicity) {
                          case Periodicity.weekly:
                            nextDueDate = task.dueDate.add(
                              Duration(days: repeatDays * 7),
                            );
                            break;
                          case Periodicity.monthly:
                            nextDueDate = DateTime(
                              task.dueDate.year,
                              task.dueDate.month + repeatDays,
                              task.dueDate.day,
                            );
                            break;
                          case Periodicity.annually:
                            nextDueDate = DateTime(
                              task.dueDate.year + repeatDays,
                              task.dueDate.month,
                              task.dueDate.day,
                            );
                            break;
                          case Periodicity.none:
                            break;
                        }

                        // Aktualizuj v Firestore
                        await _firestore
                            .collection('cinnosti')
                            .doc(task.id)
                            .update({
                              'dueDate': nextDueDate,
                              'completed': false,
                            });

                        // Aktualizuj v zozname
                        setState(() {
                          final index = _cinnosti.indexWhere(
                            (c) => c.id == task.id,
                          );
                          if (index != -1) {
                            _cinnosti[index] = _cinnosti[index].copyWith(
                              dueDate: nextDueDate!,
                              completed: false,
                            );
                          }
                        });
                      }

                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            task.periodicity == Periodicity.none
                                ? 'Úloha bola vymazaná'
                                : 'Úloha presunuta na ${_formatDate(nextDueDate!)}',
                          ),
                        ),
                      );
                    } catch (e) {
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(SnackBar(content: Text('Chyba: $e')));
                    }
                  },
                  icon: const Icon(Icons.check_circle_outline, size: 16),
                  label: const Text(
                    'Označiť za hotové',
                    style: TextStyle(fontSize: 12),
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.green[600],
                    side: BorderSide(color: Colors.green[600]!, width: 1.5),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                  ),
                ),
              )
            : Checkbox(
                value: task.completed,
                onChanged: (value) async {
                  if (value == true) {
                    try {
                      DateTime? nextDueDate;

                      // Ak nema opakovanie, vymas ju
                      if (task.periodicity == Periodicity.none) {
                        await _firestore
                            .collection('cinnosti')
                            .doc(task.id)
                            .delete();

                        setState(() {
                          _cinnosti.removeWhere((c) => c.id == task.id);
                        });
                      } else {
                        // Ma opakovanie - vypocitaj dalsi datum
                        nextDueDate = task.dueDate;
                        final repeatDays = task.repeatInterval ?? 1;

                        switch (task.periodicity) {
                          case Periodicity.weekly:
                            nextDueDate = task.dueDate.add(
                              Duration(days: repeatDays * 7),
                            );
                            break;
                          case Periodicity.monthly:
                            nextDueDate = DateTime(
                              task.dueDate.year,
                              task.dueDate.month + repeatDays,
                              task.dueDate.day,
                            );
                            break;
                          case Periodicity.annually:
                            nextDueDate = DateTime(
                              task.dueDate.year + repeatDays,
                              task.dueDate.month,
                              task.dueDate.day,
                            );
                            break;
                          case Periodicity.none:
                            break;
                        }

                        // Aktualizuj v Firestore
                        await _firestore
                            .collection('cinnosti')
                            .doc(task.id)
                            .update({
                              'dueDate': nextDueDate,
                              'completed': false,
                            });

                        // Aktualizuj v zozname
                        setState(() {
                          final index = _cinnosti.indexWhere(
                            (c) => c.id == task.id,
                          );
                          if (index != -1) {
                            _cinnosti[index] = _cinnosti[index].copyWith(
                              dueDate: nextDueDate!,
                              completed: false,
                            );
                          }
                        });
                      }

                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            task.periodicity == Periodicity.none
                                ? 'Úloha bola vymazaná'
                                : 'Úloha presunuta na ${_formatDate(nextDueDate!)}',
                          ),
                        ),
                      );
                    } catch (e) {
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(SnackBar(content: Text('Chyba: $e')));
                    }
                  }
                },
                activeColor: AppColors.primary,
              ),
      ),
    );
  }

  Widget _buildPlanovaneTab() {
    // Filtrovať činnosti pre vybraný deň
    final tasksForSelectedDay = _getTasksForDate(_selectedDate);
    
    // Zoskupenie činností podľa užívateľa
    Map<String, List<Cinnost>> groupedByUser = {};
    for (var cinnost in tasksForSelectedDay) {
      final user = cinnost.assignedTo.isNotEmpty
          ? cinnost.assignedTo
          : 'Nepriradené';
      groupedByUser.putIfAbsent(user, () => []).add(cinnost);
    }

    final userList = groupedByUser.keys.toList();
    
    // Filtrovať podľa vybraného užívateľa
    final filteredByUser = _selectedUser != null
        ? tasksForSelectedDay.where((c) => c.assignedTo == _selectedUser).toList()
        : tasksForSelectedDay;

    return Expanded(
      child: Column(
        children: [
          _buildCalendarHeader(),
          Expanded(
            child: tasksForSelectedDay.isEmpty
                ? Center(
                    child: Text(
                      'Žiadne činnosti na ${_formatDate(_selectedDate)}',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  )
                : ListView.builder(
                    itemCount: filteredByUser.length,
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 80),
                    itemBuilder: (context, index) {
                      final cinnost = filteredByUser[index];
                      // Nájdi priestor tejto činnosti
                      final priestor = _priestory.firstWhere(
                        (p) => p.id == cinnost.priestorId,
                        orElse: () => Priestor(
                          id: '',
                          householdId: widget.household.id,
                          name: 'Neznámy priestor',
                          createdAt: DateTime.now(),
                        ),
                      );

                      return Card(
                        margin: const EdgeInsets.only(bottom: 6),
                        elevation: 1,
                        color: AppColors.background.withOpacity(0.7),
                        child: Padding(
                          padding: const EdgeInsets.all(8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Header: Ikona + Názov + Menu
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(6),
                                    decoration: BoxDecoration(
                                      color: CinnostColors.hexToColor(
                                        cinnost.color,
                                      ),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Icon(
                                      CinnostIcons.getIcon(cinnost.icon),
                                      color: Colors.white,
                                      size: 18,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          cinnost.name,
                                          style: TextStyle(
                                            color: AppColors.textPrimary,
                                            fontWeight: FontWeight.w600,
                                            fontSize: 14,
                                          ),
                                        ),
                                        if (cinnost.description.isNotEmpty)
                                          Text(
                                            cinnost.description,
                                            style: TextStyle(
                                              color: AppColors.textSecondary,
                                              fontSize: 11,
                                            ),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                      ],
                                    ),
                                  ),
                                  PopupMenuButton(
                                    onSelected: (value) async {
                                      if (value == 'delete') {
                                        try {
                                          await _firestore
                                              .collection('cinnosti')
                                              .doc(cinnost.id)
                                              .delete();

                                          setState(() {
                                            _cinnosti.removeWhere((c) => c.id == cinnost.id);
                                          });

                                          ScaffoldMessenger.of(context).showSnackBar(
                                            SnackBar(
                                              content: Text('Činnosť "${cinnost.name}" bola vymazaná'),
                                            ),
                                          );
                                        } catch (e) {
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            SnackBar(content: Text('Chyba pri mazaní: $e')),
                                          );
                                        }
                                      }
                                    },
                                    itemBuilder: (context) => [
                                      const PopupMenuItem(
                                        value: 'delete',
                                        child: Row(
                                          children: [
                                            Icon(
                                              Icons.delete,
                                              color: Colors.red,
                                            ),
                                            SizedBox(width: 8),
                                            Text('Vymazať'),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              // Info row: Priestor
                              Row(
                                children: [
                                  Icon(
                                    Icons.room,
                                    size: 14,
                                    color: AppColors.textSecondary,
                                  ),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      priestor.name,
                                      style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 11,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                              if (cinnost.periodicity.index > 0 || cinnost.assignedTo.isNotEmpty)
                                const SizedBox(height: 3),
                              // Info row: Opakovanie (ak existuje)
                              if (cinnost.periodicity.index > 0)
                                Row(
                                  children: [
                                    Icon(
                                      Icons.repeat,
                                      size: 12,
                                      color: AppColors.textSecondary,
                                    ),
                                    const SizedBox(width: 4),
                                    Expanded(
                                      child: Text(
                                        _getPeriodityLabelWithInterval(cinnost.periodicity, cinnost.repeatInterval),
                                        style: TextStyle(
                                          color: AppColors.textSecondary,
                                          fontSize: 10,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                              if (cinnost.assignedTo.isNotEmpty && cinnost.periodicity.index > 0)
                                const SizedBox(height: 3),
                              // Info row: Pridelená
                              if (cinnost.assignedTo.isNotEmpty)
                                Row(
                                  children: [
                                    Icon(
                                      Icons.person,
                                      size: 12,
                                      color: AppColors.textSecondary,
                                    ),
                                    const SizedBox(width: 4),
                                    Expanded(
                                      child: Text(
                                        cinnost.assignedTo.split('@')[0],
                                        style: TextStyle(
                                          color: AppColors.textSecondary,
                                          fontSize: 10,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _showCinnostPriestorSelector,
                icon: const Icon(Icons.add),
                label: const Text('Pridať činnosť'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime date) {
    final days = [
      'Nedeľa',
      'Pondelok',
      'Utorok',
      'Streda',
      'Štvrtok',
      'Piatok',
      'Sobota',
    ];
    final dayName = days[date.weekday % 7];
    return '$dayName, ${date.day}.${date.month}.${date.year}';
  }

  String _getPeriodityLabel(Periodicity periodicity) {
    switch (periodicity) {
      case Periodicity.weekly:
        return 'Týždenne';
      case Periodicity.monthly:
        return 'Mesačne';
      case Periodicity.annually:
        return 'Ročne';
      default:
        return '';
    }
  }

  String _getPeriodityLabelWithInterval(
    Periodicity periodicity,
    int? repeatInterval,
  ) {
    if (periodicity.index == 0) return '';

    final label = _getPeriodityLabel(periodicity);
    final interval = repeatInterval ?? 1;

    if (interval == 1) {
      return label;
    }

    return '$label ($interval)';
  }

  void _showAddPriestorDialog() {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        backgroundColor: AppColors.background,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withOpacity(0.1),
                ),
                child: Icon(Icons.room, color: AppColors.primary, size: 32),
              ),
              const SizedBox(height: 16),
              Text(
                'Nový priestor',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Zadajte názov priestoru',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              TextField(
                controller: controller,
                style: TextStyle(color: AppColors.textPrimary),
                decoration: InputDecoration(
                  hintText: 'napr. Kuchyňa, Obývačka...',
                  hintStyle: TextStyle(color: AppColors.textSecondary),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: AppColors.textSecondary.withOpacity(0.3),
                    ),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: AppColors.textSecondary.withOpacity(0.3),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: AppColors.primary, width: 2),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                ),
                autofocus: true,
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: TextButton(
                      onPressed: () => Navigator.pop(context),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                          side: BorderSide(
                            color: AppColors.textSecondary.withOpacity(0.3),
                          ),
                        ),
                      ),
                      child: Text(
                        'Zrušiť',
                        style: TextStyle(color: AppColors.textSecondary),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        if (controller.text.isNotEmpty) {
                          _addPriestor(controller.text);
                          Navigator.pop(context);
                        }
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      child: const Text('Pridať'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showCinnostPriestorSelector() {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        backgroundColor: AppColors.background,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withOpacity(0.1),
                ),
                child: Icon(Icons.room, color: AppColors.primary, size: 32),
              ),
              const SizedBox(height: 16),
              Text(
                'Vyber priestor',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 24),
              // Search field
              TextField(
                decoration: InputDecoration(
                  hintText: 'Hľadaj priestor...',
                  hintStyle: TextStyle(color: AppColors.textSecondary),
                  prefixIcon: const Icon(Icons.search),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: AppColors.textSecondary.withOpacity(0.3),
                    ),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: AppColors.textSecondary.withOpacity(0.3),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: AppColors.primary, width: 2),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              // Priestory list
              SizedBox(
                height: 200,
                child: _priestory.isEmpty
                    ? Center(
                        child: Text(
                          'Žiadne priestory. Vytvor si prvý!',
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                      )
                    : ListView.builder(
                        itemCount: _priestory.length,
                        itemBuilder: (context, index) {
                          return ListTile(
                            leading: Icon(
                              Icons.door_front_door,
                              color: AppColors.primary,
                            ),
                            title: Text(_priestory[index].name),
                            onTap: () {
                              Navigator.pop(context);
                              _showAddCinnostDialog(_priestory[index].id);
                            },
                          );
                        },
                      ),
              ),
              const SizedBox(height: 16),
              // Add new priestor button
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    _showAddPriestorDialog();
                  },
                  icon: const Icon(Icons.add),
                  label: const Text('Nový priestor'),
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: AppColors.primary),
                    foregroundColor: AppColors.primary,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(
                    'Zrušiť',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showAddCinnostDialog(String priestorId) {
    final priestor = _priestory.firstWhere((p) => p.id == priestorId);

    // Form state
    final nameController = TextEditingController();
    final descriptionController = TextEditingController();
    DateTime selectedDate = _selectedDate; // Používaj vybraný deň z kalendára
    String selectedAssignedTo = _auth.currentUser?.email ?? '';
    Periodicity selectedPeriodicity = Periodicity.none;
    final repeatIntervalController = TextEditingController(text: '1');
    String selectedIcon = 'home';
    String selectedColor = CinnostColors.colors.values.first;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => Dialog(
          insetPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 24,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          child: SingleChildScrollView(
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header s priestorom
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: CinnostColors.hexToColor(
                          CinnostColors.colors.values.toList()[CinnostColors
                              .colors
                              .values
                              .toList()
                              .indexOf(selectedColor)],
                        ).withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: CinnostColors.hexToColor(
                            selectedColor,
                          ).withOpacity(0.3),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Nová činnosť',
                            style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              color: AppColors.textPrimary,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Icon(
                                Icons.room,
                                size: 18,
                                color: AppColors.textSecondary,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'Priestor: ${priestor.name}',
                                style: TextStyle(
                                  fontSize: 14,
                                  color: AppColors.textSecondary,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Názov
                    _buildFormLabel('Názov *'),
                    const SizedBox(height: 8),
                    TextField(
                      controller: nameController,
                      style: TextStyle(color: AppColors.textPrimary),
                      decoration: InputDecoration(
                        hintText: 'Čo je treba urobiť?',
                        hintStyle: TextStyle(color: AppColors.textSecondary),
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(color: Colors.grey[300]!),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 14,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),

                    // Popis
                    _buildFormLabel('Popis'),
                    const SizedBox(height: 8),
                    TextField(
                      controller: descriptionController,
                      maxLines: 3,
                      style: TextStyle(color: AppColors.textPrimary),
                      decoration: InputDecoration(
                        hintText: 'Detaily a inštrukcie...',
                        hintStyle: TextStyle(color: AppColors.textSecondary),
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(color: Colors.grey[300]!),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 14,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),

                    // Pridelené + Termín (riadok)
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildFormLabel('Pridelené'),
                              const SizedBox(height: 8),
                              Container(
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  border: Border.all(color: Colors.grey[300]!),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Theme(
                                  data: Theme.of(
                                    context,
                                  ).copyWith(canvasColor: Colors.white),
                                  child: DropdownButtonHideUnderline(
                                    child: DropdownButton<String>(
                                      value: selectedAssignedTo.isNotEmpty
                                          ? selectedAssignedTo
                                          : null,
                                      icon: Icon(
                                        Icons.person,
                                        size: 18,
                                        color: AppColors.primary,
                                      ),
                                      isExpanded: true,
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 12,
                                      ),
                                      items: [
                                        DropdownMenuItem(
                                          value: _auth.currentUser?.email ?? '',
                                          child: SizedBox(
                                            width: 140,
                                            child: Row(
                                              children: [
                                                Icon(
                                                  Icons.account_circle,
                                                  size: 14,
                                                  color: AppColors.primary,
                                                ),
                                                const SizedBox(width: 5),
                                                Expanded(
                                                  child: Text(
                                                    'Ja',
                                                    style: TextStyle(
                                                      color:
                                                          AppColors.textPrimary,
                                                      fontSize: 12,
                                                    ),
                                                    overflow:
                                                        TextOverflow.ellipsis,
                                                    maxLines: 1,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                        ...widget.household.sharedWith
                                            .where(
                                              (m) =>
                                                  m != _auth.currentUser?.email,
                                            )
                                            .map(
                                              (email) => DropdownMenuItem(
                                                value: email,
                                                child: SizedBox(
                                                  width: 140,
                                                  child: Row(
                                                    children: [
                                                      Icon(
                                                        Icons.person_outline,
                                                        size: 14,
                                                        color: AppColors
                                                            .textSecondary,
                                                      ),
                                                      const SizedBox(width: 5),
                                                      Expanded(
                                                        child: Text(
                                                          email.split('@')[0],
                                                          style: TextStyle(
                                                            color: AppColors
                                                                .textPrimary,
                                                            fontSize: 12,
                                                          ),
                                                          overflow: TextOverflow
                                                              .ellipsis,
                                                          maxLines: 1,
                                                        ),
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                              ),
                                            ),
                                      ],
                                      onChanged: (value) {
                                        setState(() {
                                          selectedAssignedTo =
                                              value ?? selectedAssignedTo;
                                        });
                                      },
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildFormLabel('Termín'),
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 14,
                                ),
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withOpacity(0.05),
                                  border: Border.all(
                                    color: AppColors.primary.withOpacity(0.3),
                                  ),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      _formatDate(selectedDate),
                                      style: TextStyle(
                                        color: AppColors.textPrimary,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                    Icon(
                                      Icons.calendar_today,
                                      size: 18,
                                      color: AppColors.primary,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),

                    // Periodicita
                    _buildFormLabel('Opakovanie'),
                    const SizedBox(height: 8),
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: Colors.grey[300]!),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Theme(
                        data: Theme.of(
                          context,
                        ).copyWith(canvasColor: Colors.white),
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<Periodicity>(
                            value: selectedPeriodicity,
                            icon: Icon(
                              Icons.repeat,
                              size: 18,
                              color: AppColors.primary,
                            ),
                            isExpanded: true,
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            items: Periodicity.values.map((p) {
                              final label = _getPeriodityLabel(p).isNotEmpty
                                  ? _getPeriodityLabel(p)
                                  : 'Bez opakovania';
                              final icon = _getPeriodicityIcon(p);
                              return DropdownMenuItem(
                                value: p,
                                child: Row(
                                  children: [
                                    Icon(
                                      icon,
                                      size: 18,
                                      color: AppColors.textSecondary,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      label,
                                      style: TextStyle(
                                        color: AppColors.textPrimary,
                                        fontSize: 13,
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }).toList(),
                            onChanged: (value) {
                              setState(() {
                                selectedPeriodicity = value ?? Periodicity.none;
                              });
                            },
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),

                    // Interval opakovania
                    if (selectedPeriodicity.index > 0) ...[
                      _buildFormLabel(
                        _getRepeatIntervalLabel(selectedPeriodicity),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: repeatIntervalController,
                        keyboardType: TextInputType.number,
                        style: TextStyle(color: AppColors.textPrimary),
                        decoration: InputDecoration(
                          hintText: _getRepeatIntervalHint(selectedPeriodicity),
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide(color: Colors.grey[300]!),
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 14,
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                    ],

                    // Ikona
                    _buildFormLabel('Ikona'),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: Colors.grey[300]!),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: EdgeInsets.zero,
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 6,
                              mainAxisSpacing: 8,
                              crossAxisSpacing: 8,
                            ),
                        itemCount: CinnostIcons.icons.length,
                        itemBuilder: (context, index) {
                          final iconOption = CinnostIcons.icons[index];
                          final iconName = iconOption.name;
                          final isSelected = selectedIcon == iconName;
                          return GestureDetector(
                            onTap: () {
                              setState(() {
                                selectedIcon = iconName;
                              });
                            },
                            child: Container(
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? CinnostColors.hexToColor(
                                        selectedColor,
                                      ).withOpacity(0.15)
                                    : Colors.grey[50],
                                border: Border.all(
                                  color: isSelected
                                      ? CinnostColors.hexToColor(selectedColor)
                                      : Colors.grey[200]!,
                                  width: isSelected ? 2 : 1,
                                ),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(
                                CinnostIcons.getIcon(iconName),
                                color: isSelected
                                    ? CinnostColors.hexToColor(selectedColor)
                                    : Colors.grey[500],
                                size: 22,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 18),

                    // Farba
                    _buildFormLabel('Farba'),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: Colors.grey[300]!),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: EdgeInsets.zero,
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 5,
                              mainAxisSpacing: 8,
                              crossAxisSpacing: 8,
                            ),
                        itemCount: CinnostColors.colors.length,
                        itemBuilder: (context, index) {
                          final colorHex = CinnostColors.colors.values
                              .elementAt(index);
                          final isSelected = selectedColor == colorHex;
                          return GestureDetector(
                            onTap: () {
                              setState(() {
                                selectedColor = colorHex ?? '#4CAF50';
                              });
                            },
                            child: Container(
                              decoration: BoxDecoration(
                                color: CinnostColors.hexToColor(
                                  colorHex ?? '#4CAF50',
                                ),
                                border: Border.all(
                                  color: isSelected
                                      ? Colors.black
                                      : Colors.grey[400]!,
                                  width: isSelected ? 3 : 1,
                                ),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: isSelected
                                  ? const Icon(
                                      Icons.check,
                                      color: Colors.white,
                                      size: 20,
                                    )
                                  : null,
                            ),
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 28),

                    // Tlačidlá
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => Navigator.pop(context),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              side: BorderSide(
                                color: AppColors.primary,
                                width: 2,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                            ),
                            child: Text(
                              'Zrušiť',
                              style: TextStyle(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w600,
                                fontSize: 16,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: () {
                              if (nameController.text.isEmpty) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Zadaj názov činnosti'),
                                  ),
                                );
                                return;
                              }

                              _addCinnost(
                                priestorId: priestorId,
                                name: nameController.text,
                                description: descriptionController.text,
                                assignedTo: selectedAssignedTo,
                                icon: selectedIcon,
                                color: selectedColor,
                                dueDate: selectedDate,
                                periodicity: selectedPeriodicity,
                                repeatInterval: selectedPeriodicity.index > 0
                                    ? int.tryParse(
                                        repeatIntervalController.text,
                                      )
                                    : null,
                              );

                              Navigator.pop(context);
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                            ),
                            child: const Text(
                              'Uložiť',
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 16,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFormLabel(String label) {
    return Text(
      label,
      style: TextStyle(
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
        fontSize: 14,
        letterSpacing: 0.3,
      ),
    );
  }

  Future<void> _addCinnost({
    required String priestorId,
    required String name,
    required String description,
    required String assignedTo,
    required String icon,
    required String color,
    required DateTime dueDate,
    required Periodicity periodicity,
    required int? repeatInterval,
  }) async {
    try {
      final newCinnost = Cinnost(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        householdId: widget.household.id,
        priestorId: priestorId,
        name: name,
        description: description,
        assignedTo: assignedTo,
        icon: icon,
        color: color,
        dueDate: dueDate,
        periodicity: periodicity,
        repeatInterval: repeatInterval,
        createdAt: DateTime.now(),
      );

      setState(() {
        _cinnosti.add(newCinnost);
      });

      final docRef = await _firestore
          .collection('cinnosti')
          .add(newCinnost.toMap());

      setState(() {
        final index = _cinnosti.indexWhere((c) => c.id == newCinnost.id);
        if (index != -1) {
          _cinnosti[index] = newCinnost.copyWith(id: docRef.id);
        }
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Činnosť "${newCinnost.name}" bola vytvorená'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      print('Chyba pri pridaní činnosti: $e');
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Chyba: $e')));
      }
    }
  }

  IconData _getPeriodicityIcon(Periodicity periodicity) {
    switch (periodicity) {
      case Periodicity.weekly:
        return Icons.calendar_today;
      case Periodicity.monthly:
        return Icons.calendar_month;
      case Periodicity.annually:
        return Icons.date_range;
      default:
        return Icons.block;
    }
  }

  String _getRepeatIntervalLabel(Periodicity periodicity) {
    switch (periodicity) {
      case Periodicity.weekly:
        return 'Každých X týždňov';
      case Periodicity.monthly:
        return 'Každých X mesiacov';
      case Periodicity.annually:
        return 'Každých X rokov';
      default:
        return 'Počet jednotiek';
    }
  }

  String _getRepeatIntervalHint(Periodicity periodicity) {
    switch (periodicity) {
      case Periodicity.weekly:
        return 'Napr. 2 = každé 2 týždne';
      case Periodicity.monthly:
        return 'Napr. 3 = každé 3 mesiace';
      case Periodicity.annually:
        return 'Napr. 2 = každé 2 roky';
      default:
        return '1';
    }
  }

  // Filtruj činnosti podľa vybraného dňa
  List<Cinnost> _getTasksForDate(DateTime date) {
    return _cinnosti.where((c) {
      final cDate = DateTime(c.dueDate.year, c.dueDate.month, c.dueDate.day);
      final selectedDate = DateTime(date.year, date.month, date.day);
      
      // Presný dátum
      if (cDate.compareTo(selectedDate) == 0) {
        return true;
      }
      
      // Opakovanie
      if (c.periodicity != Periodicity.none) {
        final daysDiff = selectedDate.difference(cDate).inDays;
        
        // Len budúce alebo dnešné dátumy
        if (daysDiff < 0) return false;
        
        switch (c.periodicity) {
          case Periodicity.weekly:
            final interval = c.repeatInterval ?? 1;
            // Skontroluj deň v týždni (1=Pondelok, 7=Nedeľa)
            if (cDate.weekday != selectedDate.weekday) return false;
            // Skontroluj počet týždňov
            final weeksDiff = daysDiff ~/ 7;
            return weeksDiff % interval == 0;
            
          case Periodicity.monthly:
            final interval = c.repeatInterval ?? 1;
            // Skontroluj deň mesiaca
            if (cDate.day != selectedDate.day) return false;
            // Skontroluj mesiac
            final monthsDiff = (selectedDate.year - cDate.year) * 12 + 
                               (selectedDate.month - cDate.month);
            return monthsDiff % interval == 0;
            
          case Periodicity.annually:
            final interval = c.repeatInterval ?? 1;
            // Skontroluj deň a mesiac
            if (cDate.day != selectedDate.day || 
                cDate.month != selectedDate.month) {
              return false;
            }
            // Skontroluj rok
            final yearsDiff = selectedDate.year - cDate.year;
            return yearsDiff % interval == 0;
            
          case Periodicity.none:
            return false;
        }
      }
      
      return false;
    }).toList();
  }

  // Horizontálny kalendár
  Widget _buildCalendarHeader() {
    String monthName(int month, int year) {
      const months = [
        'Január',
        'Február',
        'Marec',
        'Apríl',
        'Máj',
        'Jún',
        'Júl',
        'August',
        'September',
        'Október',
        'November',
        'December',
      ];
      return '${months[month - 1]} $year';
    }

    // Zistiť prvý deň mesiaca
    final firstDay = DateTime(_calendarYear, _calendarMonth, 1);
    final lastDay = DateTime(_calendarYear, _calendarMonth + 1, 0);
    final daysInMonth = lastDay.day;
    final startingWeekday = firstDay.weekday; // 1=Monday, 7=Sunday

    // Dni z predchádzajúceho mesiaca
    final emptyDays = startingWeekday - 1;

    const dayNames = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];

    return Column(
      children: [
        // Header s mesiacom a navigáciou
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left),
                color: AppColors.textPrimary,
                onPressed: _previousMonth,
              ),
              Column(
                children: [
                  Text(
                    monthName(_calendarMonth, _calendarYear),
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (_calendarMonth != DateTime.now().month || _calendarYear != DateTime.now().year)
                    GestureDetector(
                      onTap: _goToToday,
                      child: Text(
                        'Dnes',
                        style: TextStyle(
                          color: AppColors.primary,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right),
                color: AppColors.textPrimary,
                onPressed: _nextMonth,
              ),
            ],
          ),
        ),
        // Dni v týždni
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: dayNames
                .map((day) => SizedBox(
                      width: 40,
                      child: Center(
                        child: Text(
                          day,
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ))
                .toList(),
          ),
        ),
        // Grid s dňami
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 7,
              mainAxisSpacing: 4,
              crossAxisSpacing: 4,
            ),
            itemCount: emptyDays + daysInMonth,
            itemBuilder: (context, index) {
              if (index < emptyDays) {
                return const SizedBox.shrink();
              }

              final dayNumber = index - emptyDays + 1;
              final date = DateTime(_calendarYear, _calendarMonth, dayNumber);
              final isSelected = _selectedDate.year == date.year &&
                  _selectedDate.month == date.month &&
                  _selectedDate.day == date.day;
              final isToday = DateTime.now().year == date.year &&
                  DateTime.now().month == date.month &&
                  DateTime.now().day == date.day;

              // Zisti činnosti na tento deň
              final tasksOnDay = _getTasksForDate(date);
              
              // Zbierka iniciálov osôb s úlohami
              final initials = <String>{};
              for (var task in tasksOnDay) {
                if (task.assignedTo.isNotEmpty) {
                  final parts = task.assignedTo.split('@')[0].split('.');
                  if (parts.isNotEmpty) {
                    // Iniciály: prvé písmeno prvej a druhej časti
                    final initial = parts.length > 1 
                        ? '${parts[0][0]}${parts[1][0]}'.toUpperCase()
                        : parts[0][0].toUpperCase();
                    initials.add(initial);
                  }
                }
              }
              final initialsText = initials.join(', ');

              return GestureDetector(
                onTap: () {
                  setState(() {
                    _selectedDate = date;
                  });
                },
                child: Container(
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppColors.primary
                        : isToday
                            ? AppColors.primary.withOpacity(0.2)
                            : Colors.white.withOpacity(0.5),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isToday ? AppColors.primary : Colors.transparent,
                    ),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '$dayNumber',
                        style: TextStyle(
                          color: isSelected
                              ? Colors.white
                              : isToday
                                  ? AppColors.primary
                                  : AppColors.textPrimary,
                          fontWeight:
                              isSelected || isToday ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      if (initialsText.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            initialsText,
                            style: TextStyle(
                              color: isSelected
                                  ? Colors.white.withOpacity(0.8)
                                  : AppColors.textSecondary,
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

