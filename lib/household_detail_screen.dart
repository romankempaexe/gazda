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

  @override
  void initState() {
    super.initState();
    _loadPriestory();
    _loadCinnosti();
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
      appBar: AppBar(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        title: Text(widget.household.name),
        centerTitle: true,
      ),
      body: _buildBody(),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedIndex,
        onTap: (index) {
          setState(() {
            _selectedIndex = index;
          });
        },
        backgroundColor: AppColors.background,
        selectedItemColor: AppColors.primary,
        unselectedItemColor: AppColors.textSecondary,
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
    final myTasks = _cinnosti.where((c) => c.assignedTo == currentUser).toList();
    
    // Rozdeliť na dnešné, zmešané a budúce
    final today = DateTime.now();
    final todayOnly = DateTime(today.year, today.month, today.day);
    
    final todayTasks = myTasks.where((c) {
      final dueDate = DateTime(c.dueDate.year, c.dueDate.month, c.dueDate.day);
      return dueDate.compareTo(todayOnly) == 0 && !c.completed;
    }).toList()..sort((a, b) => a.dueDate.compareTo(b.dueDate)); // Zoradené podľa času
    
    final lateTasks = myTasks.where((c) {
      final dueDate = DateTime(c.dueDate.year, c.dueDate.month, c.dueDate.day);
      return dueDate.isBefore(todayOnly) && !c.completed;
    }).toList()..sort((a, b) => a.dueDate.compareTo(b.dueDate)); // Najstarší prvý
    
    final upcomingTasks = myTasks.where((c) {
      final dueDate = DateTime(c.dueDate.year, c.dueDate.month, c.dueDate.day);
      return dueDate.isAfter(todayOnly) && !c.completed;
    }).toList()..sort((a, b) => a.dueDate.compareTo(b.dueDate)); // Zoradené podľa času
    
    // Zlúčiť všetky úlohy v poradí: zmešané -> dnes -> budúce (podľa času)
    final allTasks = [...lateTasks, ...todayTasks, ...upcomingTasks];
    
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
    
    return SingleChildScrollView(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          ...allTasks.map((task) {
            // Urči na základe dátumu
            final dueDate = DateTime(task.dueDate.year, task.dueDate.month, task.dueDate.day);
            final isMissed = dueDate.isBefore(todayOnly);
            
            return _buildTaskItem(task, showButton: true);
          }),
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
      margin: const EdgeInsets.only(bottom: 10),
      color: AppColors.background,
      elevation: 1,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: CinnostColors.hexToColor(task.color),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            CinnostIcons.getIcon(task.icon),
            color: Colors.white,
            size: 20,
          ),
        ),
        title: Text(
          task.name,
          style: TextStyle(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(Icons.location_on, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Text(
                  priestor.name,
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(Icons.calendar_today, size: 14, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Text(
                  _formatDate(task.dueDate),
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
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
                        await _firestore.collection('cinnosti').doc(task.id).delete();
                        
                        setState(() {
                          _cinnosti.removeWhere((c) => c.id == task.id);
                        });
                      } else {
                        // Ma opakovanie - vypocitaj dalsi datum
                        nextDueDate = task.dueDate;
                        final repeatDays = task.repeatInterval ?? 1;
                        
                        switch (task.periodicity) {
                          case Periodicity.weekly:
                            nextDueDate = task.dueDate.add(Duration(days: repeatDays * 7));
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
                        await _firestore.collection('cinnosti').doc(task.id).update({
                          'dueDate': nextDueDate,
                          'completed': false,
                        });
                        
                        // Aktualizuj v zozname
                        setState(() {
                          final index = _cinnosti.indexWhere((c) => c.id == task.id);
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
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Chyba: $e')),
                      );
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
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
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
                        await _firestore.collection('cinnosti').doc(task.id).delete();
                        
                        setState(() {
                          _cinnosti.removeWhere((c) => c.id == task.id);
                        });
                      } else {
                        // Ma opakovanie - vypocitaj dalsi datum
                        nextDueDate = task.dueDate;
                        final repeatDays = task.repeatInterval ?? 1;
                        
                        switch (task.periodicity) {
                          case Periodicity.weekly:
                            nextDueDate = task.dueDate.add(Duration(days: repeatDays * 7));
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
                        await _firestore.collection('cinnosti').doc(task.id).update({
                          'dueDate': nextDueDate,
                          'completed': false,
                        });
                        
                        // Aktualizuj v zozname
                        setState(() {
                          final index = _cinnosti.indexWhere((c) => c.id == task.id);
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
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Chyba: $e')),
                      );
                    }
                  }
                },
                activeColor: AppColors.primary,
              ),
      ),
    );
  }

  Widget _buildPlanovaneTab() {
    // Zoskupenie činností podľa užívateľa
    Map<String, List<Cinnost>> groupedByUser = {};
    for (var cinnost in _cinnosti) {
      final user = cinnost.assignedTo.isNotEmpty ? cinnost.assignedTo : 'Nepriradené';
      groupedByUser.putIfAbsent(user, () => []).add(cinnost);
    }

    final userList = groupedByUser.keys.toList();

    return Column(
      children: [
        // Záložky užívateľov
        if (userList.isNotEmpty)
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
              child: Wrap(
                spacing: 8,
                children: userList.map((user) {
                  final count = groupedByUser[user]?.length ?? 0;
                  final userName = user == 'Nepriradené' 
                      ? 'Nepriradené' 
                      : user.split('@')[0];
                  return FilterChip(
                    label: Text(
                      '$userName ($count)',
                      style: TextStyle(
                        color: _selectedUser == user 
                            ? Colors.white 
                            : AppColors.textPrimary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    selected: _selectedUser == user,
                    onSelected: (selected) {
                      setState(() {
                        _selectedUser = selected ? user : null;
                      });
                    },
                    backgroundColor: Colors.grey[100],
                    selectedColor: AppColors.primary,
                    showCheckmark: false,
                  );
                }).toList(),
              ),
            ),
          ),
        Expanded(
          child: _cinnosti.isEmpty
              ? Center(
                  child: Text(
                    'Žiadne činnosti',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                )
              : ListView.builder(
                  itemCount: _filteredCinnosti.length,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  itemBuilder: (context, index) {
                    final cinnost = _filteredCinnosti[index];
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
                      margin: const EdgeInsets.only(bottom: 12),
                      elevation: 2,
                      color: AppColors.background,
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Header: Ikona + Názov + Menu
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: CinnostColors.hexToColor(
                                      cinnost.color,
                                    ),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Icon(
                                    CinnostIcons.getIcon(cinnost.icon),
                                    color: Colors.white,
                                    size: 24,
                                  ),
                                ),
                                const SizedBox(width: 12),
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
                                          fontSize: 16,
                                        ),
                                      ),
                                      if (cinnost.description.isNotEmpty)
                                        Text(
                                          cinnost.description,
                                          style: TextStyle(
                                            color: AppColors.textSecondary,
                                            fontSize: 13,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                    ],
                                  ),
                                ),
                                PopupMenuButton(
                                  onSelected: (value) {
                                    if (value == 'delete') {
                                      // TODO: Implementovať mazanie činnosti
                                    }
                                  },
                                  itemBuilder: (context) => [
                                    const PopupMenuItem(
                                      value: 'delete',
                                      child: Row(
                                        children: [
                                          Icon(Icons.delete, color: Colors.red),
                                          SizedBox(width: 8),
                                          Text('Vymazať'),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            // Info row: Priestor
                            Row(
                              children: [
                                Icon(
                                  Icons.room,
                                  size: 18,
                                  color: AppColors.textSecondary,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  priestor.name,
                                  style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            // Info row: Kedy
                            if (cinnost.dueDate != null)
                              Row(
                                children: [
                                  Icon(
                                    Icons.calendar_today,
                                    size: 18,
                                    color: AppColors.textSecondary,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      'Do: ${_formatDate(cinnost.dueDate!)}',
                                      style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 13,
                                      ),
                                    ),
                                  ),
                                  if (cinnost.periodicity.index > 0)
                                    Text(
                                      '• ${_getPeriodityLabelWithInterval(cinnost.periodicity, cinnost.repeatInterval)}',
                                      style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 12,
                                      ),
                                    ),
                                ],
                              ),
                            const SizedBox(height: 8),
                            // Info row: Pridelená
                            if (cinnost.assignedTo.isNotEmpty)
                              Row(
                                children: [
                                  Icon(
                                    Icons.person,
                                    size: 18,
                                    color: AppColors.textSecondary,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      cinnost.assignedTo,
                                      style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 13,
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
    );
  }

  String _formatDate(DateTime date) {
    final days = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];
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

  String _getPeriodityLabelWithInterval(Periodicity periodicity, int? repeatInterval) {
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
    DateTime selectedDate = DateTime.now().add(const Duration(days: 1));
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
                                                      color: AppColors
                                                          .textPrimary,
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
                                                          overflow:
                                                              TextOverflow
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
                              Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  onTap: () async {
                                    final picked = await showDatePicker(
                                      context: context,
                                      initialDate: selectedDate,
                                      firstDate: DateTime.now(),
                                      lastDate: DateTime.now().add(
                                        const Duration(days: 365),
                                      ),
                                      locale: const Locale('sk', 'SK'), // Slovenčina - začína od pondelka
                                      builder: (context, child) {
                                        return Theme(
                                          data: Theme.of(context).copyWith(
                                            colorScheme: ColorScheme.light(
                                              primary: AppColors.primary,
                                              onPrimary: Colors.white,
                                              surface: Colors.white,
                                              onSurface: AppColors.textPrimary,
                                            ),
                                            textButtonTheme:
                                                TextButtonThemeData(
                                                  style: TextButton.styleFrom(
                                                    foregroundColor:
                                                        AppColors.primary,
                                                  ),
                                                ),
                                          ),
                                          child: child!,
                                        );
                                      },
                                    );
                                    if (picked != null) {
                                      setState(() {
                                        selectedDate = picked;
                                      });
                                    }
                                  },
                                  borderRadius: BorderRadius.circular(10),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 14,
                                    ),
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      border: Border.all(
                                        color: Colors.grey[300]!,
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
                      _buildFormLabel(_getRepeatIntervalLabel(selectedPeriodicity)),
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
                              padding: const EdgeInsets.symmetric(
                                vertical: 14,
                              ),
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
}
