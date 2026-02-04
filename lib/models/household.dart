import 'package:cloud_firestore/cloud_firestore.dart';

class Household {
  final String id;
  final String name;
  final String createdBy;
  final String createdByEmail;
  final List<String> sharedWith;
  final DateTime createdAt;

  Household({
    required this.id,
    required this.name,
    required this.createdBy,
    required this.createdByEmail,
    required this.sharedWith,
    required this.createdAt,
  });

  // Convert to Firestore document
  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'createdBy': createdBy,
      'createdByEmail': createdByEmail,
      'sharedWith': sharedWith,
      'createdAt': createdAt,
    };
  }

  // Create from Firestore document
  factory Household.fromMap(Map<String, dynamic> map, String id) {
    return Household(
      id: id,
      name: map['name'] ?? '',
      createdBy: map['createdBy'] ?? '',
      createdByEmail: map['createdByEmail'] ?? '',
      sharedWith: List<String>.from(map['sharedWith'] ?? []),
      createdAt: (map['createdAt'] as Timestamp).toDate(),
    );
  }

  // Create copy with modified fields
  Household copyWith({
    String? id,
    String? name,
    String? createdBy,
    String? createdByEmail,
    List<String>? sharedWith,
    DateTime? createdAt,
  }) {
    return Household(
      id: id ?? this.id,
      name: name ?? this.name,
      createdBy: createdBy ?? this.createdBy,
      createdByEmail: createdByEmail ?? this.createdByEmail,
      sharedWith: sharedWith ?? this.sharedWith,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
